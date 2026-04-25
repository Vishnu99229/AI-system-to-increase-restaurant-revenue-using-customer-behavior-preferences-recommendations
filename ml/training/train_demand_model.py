from __future__ import annotations

import math
import sys
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import psycopg2
import torch
from sklearn.preprocessing import MinMaxScaler
from torch.utils.data import DataLoader, TensorDataset


ML_ROOT = Path(__file__).resolve().parents[1]
if str(ML_ROOT) not in sys.path:
    sys.path.insert(0, str(ML_ROOT))

from models.demand_forecast import DemandLSTM, load_model_artifacts, save_model_artifacts
from synthetic.bangalore_calendar import get_calendar_effects
from synthetic.weather_data import generate_weather_for_day


FEATURE_COLUMNS = [
    "day_of_week_sin",
    "day_of_week_cos",
    "month_sin",
    "month_cos",
    "is_weekend",
    "is_payday_window",
    "temperature",
    "is_rain",
    "temperature_normalized",
    "is_holiday",
    "holiday_impact",
    "sales_yesterday",
    "sales_avg_7d",
    "sales_avg_14d",
    "sales_avg_28d",
    "sales_same_day_last_week",
    "sales_trend_7d",
    "total_daily_orders",
    "item_price_normalized",
    "item_category_encoded",
]


@dataclass
class PreparedData:
    X_train: np.ndarray
    y_train: np.ndarray
    X_val: np.ndarray
    y_val: np.ndarray
    X_test: np.ndarray
    y_test: np.ndarray
    test_menu_item_ids: np.ndarray
    test_dates: np.ndarray
    scaler: MinMaxScaler
    input_size: int
    menu_items: dict[int, dict[str, Any]]
    category_mapping: dict[str, int]
    train_days: int
    val_days: int
    test_days: int
    feature_columns: list[str]


def train(
    cafe_slug: str,
    db_config: dict[str, Any],
    lookback_days: int = 14,
    epochs: int = 100,
    batch_size: int = 32,
    hidden_size: int = 128,
    num_layers: int = 2,
    dropout: float = 0.2,
) -> dict[str, Any]:
    started_at = time.time()
    print(f"Loading and preparing data for cafe domain={cafe_slug}...")
    prepared = prepare_training_data(cafe_slug, db_config, lookback_days)

    model = DemandLSTM(
        input_size=prepared.input_size,
        hidden_size=hidden_size,
        num_layers=num_layers,
        dropout=dropout,
    )
    optimizer = torch.optim.Adam(model.parameters(), lr=0.001)
    loss_fn = torch.nn.MSELoss()
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer, mode="min", factor=0.5, patience=5)

    train_loader = DataLoader(
        TensorDataset(
            torch.tensor(prepared.X_train, dtype=torch.float32),
            torch.tensor(prepared.y_train, dtype=torch.float32),
        ),
        batch_size=batch_size,
        shuffle=True,
    )
    val_x = torch.tensor(prepared.X_val, dtype=torch.float32)
    val_y = torch.tensor(prepared.y_val, dtype=torch.float32)

    best_state = None
    best_val_loss = float("inf")
    best_epoch = 0
    patience = 10
    stale_epochs = 0

    print(f"Training LSTM: {len(prepared.y_train)} train samples, {len(prepared.y_val)} validation samples")
    for epoch in range(1, epochs + 1):
        model.train()
        train_losses = []
        for batch_x, batch_y in train_loader:
            optimizer.zero_grad()
            predictions = model(batch_x)
            loss = loss_fn(predictions, batch_y)
            loss.backward()
            optimizer.step()
            train_losses.append(float(loss.item()))

        model.eval()
        with torch.no_grad():
            val_predictions = model(val_x)
            val_loss = float(loss_fn(val_predictions, val_y).item())

        train_loss = float(np.mean(train_losses))
        scheduler.step(val_loss)
        print(f"Epoch {epoch:03d}/{epochs} | train_loss={train_loss:.4f} | val_loss={val_loss:.4f}")

        if val_loss < best_val_loss:
            best_val_loss = val_loss
            best_epoch = epoch
            best_state = {key: value.detach().clone() for key, value in model.state_dict().items()}
            stale_epochs = 0
        else:
            stale_epochs += 1
            if stale_epochs >= patience:
                print(f"Early stopping at epoch {epoch}; best validation loss was at epoch {best_epoch}.")
                break

    if best_state is not None:
        model.load_state_dict(best_state)

    metrics = evaluate_arrays(model, prepared.X_test, prepared.y_test, prepared.test_menu_item_ids, prepared.menu_items)
    training_time = round(time.time() - started_at, 2)
    epochs_trained = best_epoch if best_epoch else epoch

    metadata = {
        "cafe_slug": cafe_slug,
        "input_size": prepared.input_size,
        "hidden_size": hidden_size,
        "num_layers": num_layers,
        "dropout": dropout,
        "lookback_days": lookback_days,
        "training_date": datetime.utcnow().isoformat(),
        "best_val_loss": best_val_loss,
        "epochs_trained": epochs_trained,
        "feature_columns": prepared.feature_columns,
        "category_mapping": prepared.category_mapping,
        "menu_items": {str(item_id): item for item_id, item in prepared.menu_items.items()},
        "overall_mape": metrics["overall"]["mape"],
        "item_mape": {str(item_id): values["mape"] for item_id, values in metrics["by_item"].items()},
    }
    paths = save_model_artifacts(cafe_slug, model, prepared.scaler, metadata)

    print_training_report(cafe_slug, prepared, metrics, best_val_loss, epochs_trained, epochs, training_time)
    print(f"\nSaved model: {paths['model']}")
    print(f"Saved scaler: {paths['scaler']}")
    print(f"Saved metadata: {paths['metadata']}")
    return {"metadata": metadata, "metrics": metrics, "paths": paths}


def prepare_training_data(cafe_slug: str, db_config: dict[str, Any], lookback_days: int = 14) -> PreparedData:
    raw = load_raw_data(cafe_slug, db_config)
    feature_frame, menu_items, category_mapping = build_feature_frame(raw, cafe_slug)
    sequences = create_sequences(feature_frame, lookback_days)

    if len(sequences["y"]) == 0:
        raise ValueError("Not enough history to create LSTM sequences.")

    split = split_sequences(sequences)
    scaler = MinMaxScaler()
    train_2d = split["X_train"].reshape(-1, split["X_train"].shape[-1])
    scaler.fit(train_2d)

    for key in ("X_train", "X_val", "X_test"):
        shape = split[key].shape
        split[key] = scaler.transform(split[key].reshape(-1, shape[-1])).reshape(shape)

    return PreparedData(
        X_train=split["X_train"],
        y_train=split["y_train"],
        X_val=split["X_val"],
        y_val=split["y_val"],
        X_test=split["X_test"],
        y_test=split["y_test"],
        test_menu_item_ids=split["test_menu_item_ids"],
        test_dates=split["test_dates"],
        scaler=scaler,
        input_size=len(FEATURE_COLUMNS),
        menu_items=menu_items,
        category_mapping=category_mapping,
        train_days=split["train_days"],
        val_days=split["val_days"],
        test_days=split["test_days"],
        feature_columns=FEATURE_COLUMNS,
    )


def load_raw_data(cafe_slug: str, db_config: dict[str, Any]) -> dict[str, Any]:
    conn = psycopg2.connect(**db_config)
    try:
        menu_df = pd.read_sql_query(
            """
            SELECT m.id, m.name, m.price, COALESCE(m.category, 'Uncategorized') AS category
            FROM menus m
            JOIN restaurants r ON r.id = m.restaurant_id
            WHERE r.domain = %s
            ORDER BY m.id
            """,
            conn,
            params=(cafe_slug,),
        )
        if menu_df.empty:
            raise ValueError(f"No menu items found for cafe domain={cafe_slug}")

        restaurant_df = pd.read_sql_query("SELECT id FROM restaurants WHERE domain = %s", conn, params=(cafe_slug,))
        if restaurant_df.empty:
            raise ValueError(f"Restaurant not found for domain={cafe_slug}")
        restaurant_id = int(restaurant_df.iloc[0]["id"])

        sales_df = pd.read_sql_query(
            """
            SELECT
                oi.menu_item_id,
                DATE(o.created_at) AS sale_date,
                SUM(oi.quantity)::float AS units_sold
            FROM order_items oi
            JOIN orders o ON o.id = oi.order_id
            WHERE o.restaurant_id = %s
            GROUP BY oi.menu_item_id, DATE(o.created_at)
            ORDER BY sale_date
            """,
            conn,
            params=(restaurant_id,),
        )
        if sales_df.empty:
            raise ValueError(f"No order item sales found for cafe domain={cafe_slug}")

        total_orders_df = pd.read_sql_query(
            """
            SELECT DATE(created_at) AS sale_date, COUNT(*)::float AS total_daily_orders
            FROM orders
            WHERE restaurant_id = %s
            GROUP BY DATE(created_at)
            ORDER BY sale_date
            """,
            conn,
            params=(restaurant_id,),
        )

        min_date = pd.to_datetime(sales_df["sale_date"]).dt.date.min()
        max_date = pd.to_datetime(sales_df["sale_date"]).dt.date.max()
        weather_df = load_weather_frame(conn, cafe_slug, min_date, max_date)
    finally:
        conn.close()

    return {
        "menu": menu_df,
        "sales": sales_df,
        "total_orders": total_orders_df,
        "weather": weather_df,
        "min_date": min_date,
        "max_date": max_date,
    }


def load_weather_frame(conn: Any, cafe_slug: str, min_date: date, max_date: date) -> pd.DataFrame:
    try:
        weather_df = pd.read_sql_query(
            """
            SELECT weather_date, temperature_high, temperature_low, is_rain, humidity
            FROM daily_weather
            WHERE cafe_slug = %s AND weather_date BETWEEN %s AND %s
            ORDER BY weather_date
            """,
            conn,
            params=(cafe_slug, min_date, max_date),
        )
    except Exception:
        weather_df = pd.DataFrame()

    all_dates = pd.date_range(min_date, max_date, freq="D").date
    if weather_df.empty or len(weather_df) < len(all_dates):
        rng = np.random.default_rng(42)
        generated = []
        for current_date in all_dates:
            weather = generate_weather_for_day(current_date, rng)
            generated.append(
                {
                    "weather_date": current_date,
                    "temperature_high": weather.temperature_c,
                    "temperature_low": weather.temperature_c - 5.0,
                    "is_rain": weather.rain_mm > 0,
                    "humidity": int(round(weather.humidity * 100)),
                }
            )
        generated_df = pd.DataFrame(generated)
        if weather_df.empty:
            return generated_df
        weather_df["weather_date"] = pd.to_datetime(weather_df["weather_date"]).dt.date
        return generated_df.set_index("weather_date").combine_first(weather_df.set_index("weather_date")).reset_index()

    weather_df["weather_date"] = pd.to_datetime(weather_df["weather_date"]).dt.date
    return weather_df


def build_feature_frame(raw: dict[str, Any], cafe_slug: str) -> tuple[pd.DataFrame, dict[int, dict[str, Any]], dict[str, int]]:
    menu_df = raw["menu"].copy()
    sales_df = raw["sales"].copy()
    total_orders_df = raw["total_orders"].copy()
    weather_df = raw["weather"].copy()
    min_date = raw["min_date"]
    max_date = raw["max_date"]

    sales_df["sale_date"] = pd.to_datetime(sales_df["sale_date"]).dt.date
    total_orders_df["sale_date"] = pd.to_datetime(total_orders_df["sale_date"]).dt.date
    weather_df["weather_date"] = pd.to_datetime(weather_df["weather_date"]).dt.date

    dates = pd.date_range(min_date, max_date, freq="D").date
    menu_ids = menu_df["id"].astype(int).tolist()

    sales_matrix = (
        sales_df.pivot_table(index="sale_date", columns="menu_item_id", values="units_sold", aggfunc="sum")
        .reindex(index=dates, columns=menu_ids)
        .fillna(0.0)
        .sort_index()
    )
    total_orders = total_orders_df.set_index("sale_date")["total_daily_orders"].reindex(dates).fillna(0.0)
    weather = weather_df.set_index("weather_date").reindex(dates).ffill().bfill()
    weather_temperature = weather["temperature_high"].astype(float)
    temp_mean = float(weather_temperature.mean())
    temp_std = float(weather_temperature.std()) or 1.0

    max_price = float(menu_df["price"].astype(float).max()) or 1.0
    categories = sorted(menu_df["category"].fillna("Uncategorized").astype(str).unique())
    category_mapping = {category: idx for idx, category in enumerate(categories)}
    category_denominator = max(len(category_mapping) - 1, 1)

    menu_items = {
        int(row.id): {
            "id": int(row.id),
            "name": str(row.name),
            "price": float(row.price),
            "category": str(row.category),
        }
        for row in menu_df.itertuples(index=False)
    }

    rows = []
    for menu_item in menu_df.itertuples(index=False):
        menu_item_id = int(menu_item.id)
        series = sales_matrix[menu_item_id].astype(float)
        shifted = series.shift(1).fillna(0.0)
        avg_7 = shifted.rolling(7, min_periods=1).mean()
        avg_14 = shifted.rolling(14, min_periods=1).mean()
        avg_28 = shifted.rolling(28, min_periods=1).mean()
        same_day_last_week = series.shift(7).fillna(0.0)
        trend_7d = ((avg_7 - avg_14) / avg_14.replace(0, np.nan)).replace([np.inf, -np.inf], 0).fillna(0.0)
        price_norm = float(menu_item.price) / max_price
        category_encoded = category_mapping[str(menu_item.category)] / category_denominator

        for day_index, current_day in enumerate(dates):
            calendar = get_calendar_effects(current_day)
            day_of_week = current_day.weekday()
            month = current_day.month
            temperature = float(weather.loc[current_day, "temperature_high"])
            rows.append(
                {
                    "menu_item_id": menu_item_id,
                    "sale_date": current_day,
                    "day_index": day_index,
                    "units_sold": float(series.loc[current_day]),
                    "day_of_week_sin": math.sin(2 * math.pi * day_of_week / 7),
                    "day_of_week_cos": math.cos(2 * math.pi * day_of_week / 7),
                    "month_sin": math.sin(2 * math.pi * month / 12),
                    "month_cos": math.cos(2 * math.pi * month / 12),
                    "is_weekend": 1.0 if calendar.is_weekend else 0.0,
                    "is_payday_window": 1.0 if calendar.is_payday_window else 0.0,
                    "temperature": temperature,
                    "is_rain": 1.0 if bool(weather.loc[current_day, "is_rain"]) else 0.0,
                    "temperature_normalized": (temperature - temp_mean) / temp_std,
                    "is_holiday": 1.0 if calendar.is_public_holiday else 0.0,
                    "holiday_impact": calendar.daily_multiplier,
                    "sales_yesterday": float(shifted.loc[current_day]),
                    "sales_avg_7d": float(avg_7.loc[current_day]),
                    "sales_avg_14d": float(avg_14.loc[current_day]),
                    "sales_avg_28d": float(avg_28.loc[current_day]),
                    "sales_same_day_last_week": float(same_day_last_week.loc[current_day]),
                    "sales_trend_7d": float(trend_7d.loc[current_day]),
                    "total_daily_orders": float(total_orders.loc[current_day]),
                    "item_price_normalized": price_norm,
                    "item_category_encoded": category_encoded,
                }
            )

    feature_frame = pd.DataFrame(rows).sort_values(["menu_item_id", "sale_date"]).reset_index(drop=True)
    return feature_frame, menu_items, category_mapping


def create_sequences(feature_frame: pd.DataFrame, lookback_days: int) -> dict[str, np.ndarray]:
    sequence_rows = []
    for menu_item_id, group in feature_frame.groupby("menu_item_id"):
        group = group.sort_values("sale_date").reset_index(drop=True)
        for current_idx in range(max(28, lookback_days) - 1, len(group) - 1):
            sequence = group.loc[current_idx - lookback_days + 1:current_idx, FEATURE_COLUMNS].to_numpy(dtype=np.float32)
            target_row = group.loc[current_idx + 1]
            sequence_rows.append(
                {
                    "X": sequence,
                    "y": float(target_row["units_sold"]),
                    "menu_item_id": int(menu_item_id),
                    "target_date": target_row["sale_date"],
                    "target_day_index": int(target_row["day_index"]),
                }
            )

    return {
        "X": np.array([row["X"] for row in sequence_rows], dtype=np.float32),
        "y": np.array([row["y"] for row in sequence_rows], dtype=np.float32),
        "menu_item_ids": np.array([row["menu_item_id"] for row in sequence_rows], dtype=np.int64),
        "target_dates": np.array([row["target_date"] for row in sequence_rows], dtype=object),
        "target_day_indices": np.array([row["target_day_index"] for row in sequence_rows], dtype=np.int64),
    }


def split_sequences(sequences: dict[str, np.ndarray]) -> dict[str, Any]:
    unique_target_days = sorted(set(int(day) for day in sequences["target_day_indices"]))
    if unique_target_days and max(unique_target_days) >= 160:
        train_mask = sequences["target_day_indices"] <= 139
        val_mask = (sequences["target_day_indices"] >= 140) & (sequences["target_day_indices"] <= 159)
        test_mask = sequences["target_day_indices"] >= 160
    else:
        count = len(sequences["y"])
        train_end = int(count * 0.70)
        val_end = int(count * 0.85)
        indices = np.arange(count)
        train_mask = indices < train_end
        val_mask = (indices >= train_end) & (indices < val_end)
        test_mask = indices >= val_end

    if not val_mask.any() or not test_mask.any():
        raise ValueError("Not enough data after warmup to create train/validation/test splits.")

    return {
        "X_train": sequences["X"][train_mask],
        "y_train": sequences["y"][train_mask],
        "X_val": sequences["X"][val_mask],
        "y_val": sequences["y"][val_mask],
        "X_test": sequences["X"][test_mask],
        "y_test": sequences["y"][test_mask],
        "test_menu_item_ids": sequences["menu_item_ids"][test_mask],
        "test_dates": sequences["target_dates"][test_mask],
        "train_days": len(set(sequences["target_day_indices"][train_mask])),
        "val_days": len(set(sequences["target_day_indices"][val_mask])),
        "test_days": len(set(sequences["target_day_indices"][test_mask])),
    }


def evaluate_arrays(
    model: DemandLSTM,
    X: np.ndarray,
    y: np.ndarray,
    menu_item_ids: np.ndarray,
    menu_items: dict[int, dict[str, Any]],
) -> dict[str, Any]:
    model.eval()
    with torch.no_grad():
        predictions = model(torch.tensor(X, dtype=torch.float32)).numpy()
    predictions = np.maximum(0, predictions)

    errors = predictions - y
    overall_mae = float(np.mean(np.abs(errors)))
    overall_rmse = float(np.sqrt(np.mean(errors ** 2)))
    nonzero = y > 0
    overall_mape = float(np.mean(np.abs(errors[nonzero] / y[nonzero])) * 100) if nonzero.any() else 0.0

    by_item: dict[int, dict[str, float]] = {}
    for item_id in sorted(set(int(value) for value in menu_item_ids)):
        mask = menu_item_ids == item_id
        item_y = y[mask]
        item_pred = predictions[mask]
        item_errors = item_pred - item_y
        item_nonzero = item_y > 0
        by_item[item_id] = {
            "name": menu_items[item_id]["name"],
            "avg_daily_sales": float(np.mean(item_y)),
            "mae": float(np.mean(np.abs(item_errors))),
            "rmse": float(np.sqrt(np.mean(item_errors ** 2))),
            "mape": float(np.mean(np.abs(item_errors[item_nonzero] / item_y[item_nonzero])) * 100) if item_nonzero.any() else 0.0,
        }

    return {
        "overall": {"mae": overall_mae, "mape": overall_mape, "rmse": overall_rmse},
        "by_item": by_item,
        "predictions": predictions,
        "actuals": y,
    }


def print_training_report(
    cafe_slug: str,
    prepared: PreparedData,
    metrics: dict[str, Any],
    best_val_loss: float,
    epochs_trained: int,
    max_epochs: int,
    training_time: float,
) -> None:
    overall = metrics["overall"]
    by_volume = sorted(metrics["by_item"].values(), key=lambda row: row["avg_daily_sales"], reverse=True)
    worst = sorted(metrics["by_item"].values(), key=lambda row: row["mape"], reverse=True)

    print("\n=== LSTM Demand Forecast Training Complete ===")
    print(f"Cafe: {cafe_slug}")
    print(f"Training days: {prepared.train_days} | Validation days: {prepared.val_days} | Test days: {prepared.test_days}")
    print(f"Best validation loss: {best_val_loss:.4f}")
    print(f"Epochs trained: {epochs_trained} / {max_epochs}")
    print(f"Training time: {training_time:.1f} seconds")

    print("\n=== Test Set Evaluation ===")
    print(f"Overall MAE: {overall['mae']:.2f} units")
    print(f"Overall MAPE: {overall['mape']:.1f}%")
    print(f"Overall RMSE: {overall['rmse']:.2f} units")

    print("\n=== Per-Item Performance (Top 10 by volume) ===")
    print("Item                    | Avg Daily Sales | MAE  | MAPE   | Rating")
    for row in by_volume[:10]:
        print(f"{row['name'][:23]:23} | {row['avg_daily_sales']:15.1f} | {row['mae']:4.1f} | {row['mape']:6.1f}% | {rating(row['mape'])}")

    print("\n=== Worst Predictions (items to watch) ===")
    for row in worst[:5]:
        print(f"{row['name'][:23]:23} | {row['avg_daily_sales']:15.1f} | {row['mae']:4.1f} | {row['mape']:6.1f}% | {rating(row['mape'])}")


def rating(mape: float) -> str:
    if mape < 10:
        return "5-star"
    if mape < 15:
        return "4-star"
    if mape < 25:
        return "3-star"
    if mape < 35:
        return "2-star"
    return "1-star"


def prepare_prediction_sequences(
    cafe_slug: str,
    db_config: dict[str, Any],
    scaler: MinMaxScaler,
    lookback_days: int,
    metadata: dict[str, Any],
) -> dict[str, Any]:
    raw = load_raw_data(cafe_slug, db_config)
    feature_frame, menu_items, _ = build_feature_frame(raw, cafe_slug)
    last_date = max(feature_frame["sale_date"])
    forecast_date = last_date + timedelta(days=1)
    X_rows = []
    menu_item_ids = []
    last_7d_average: dict[int, float] = {}

    for menu_item_id, group in feature_frame.groupby("menu_item_id"):
        group = group.sort_values("sale_date").reset_index(drop=True)
        if len(group) < lookback_days:
            continue
        sequence = group.tail(lookback_days)[FEATURE_COLUMNS].to_numpy(dtype=np.float32)
        shape = sequence.shape
        scaled = scaler.transform(sequence.reshape(-1, shape[-1])).reshape(shape)
        X_rows.append(scaled)
        menu_item_ids.append(int(menu_item_id))
        last_7d_average[int(menu_item_id)] = float(group.tail(7)["units_sold"].mean())

    weather = prediction_weather(raw["weather"], forecast_date)
    calendar = get_calendar_effects(forecast_date)
    return {
        "X": np.array(X_rows, dtype=np.float32),
        "menu_item_ids": menu_item_ids,
        "forecast_date": forecast_date,
        "weather": weather,
        "calendar": calendar,
        "last_7d_average": last_7d_average,
        "menu_items": menu_items,
    }


def prediction_weather(weather_df: pd.DataFrame, forecast_date: date) -> dict[str, Any]:
    weather_df = weather_df.copy()
    weather_df["weather_date"] = pd.to_datetime(weather_df["weather_date"]).dt.date
    match = weather_df[weather_df["weather_date"] == forecast_date]
    if not match.empty:
        row = match.iloc[0]
        return {"temperature_high": float(row["temperature_high"]), "is_rain": bool(row["is_rain"])}
    rng = np.random.default_rng(42 + forecast_date.toordinal())
    weather = generate_weather_for_day(forecast_date, rng)
    return {"temperature_high": weather.temperature_c, "is_rain": weather.rain_mm > 0}


def evaluate_saved_model(cafe_slug: str, db_config: dict[str, Any]) -> dict[str, Any]:
    model, scaler, metadata = load_model_artifacts(cafe_slug)
    prepared = prepare_training_data(cafe_slug, db_config, int(metadata.get("lookback_days", 14)))
    metrics = evaluate_arrays(model, prepared.X_test, prepared.y_test, prepared.test_menu_item_ids, prepared.menu_items)
    print_training_report(
        cafe_slug,
        prepared,
        metrics,
        float(metadata.get("best_val_loss", 0)),
        int(metadata.get("epochs_trained", 0)),
        int(metadata.get("epochs_trained", 0)),
        0.0,
    )
    return metrics
