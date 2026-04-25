from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import psycopg2
import torch
import torch.nn as nn


ML_ROOT = Path(__file__).resolve().parents[1]
if str(ML_ROOT) not in sys.path:
    sys.path.insert(0, str(ML_ROOT))

SAVED_MODELS_DIR = ML_ROOT / "saved_models"


class DemandLSTM(nn.Module):
    def __init__(self, input_size: int, hidden_size: int = 128, num_layers: int = 2, dropout: float = 0.2):
        super().__init__()
        self.lstm = nn.LSTM(
            input_size=input_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            dropout=dropout if num_layers > 1 else 0.0,
            batch_first=True,
        )
        self.fc1 = nn.Linear(hidden_size, 64)
        self.relu = nn.ReLU()
        self.dropout = nn.Dropout(dropout)
        self.fc2 = nn.Linear(64, 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        lstm_out, _ = self.lstm(x)
        last_output = lstm_out[:, -1, :]
        out = self.fc1(last_output)
        out = self.relu(out)
        out = self.dropout(out)
        out = self.fc2(out)
        return out.squeeze(-1)


def model_paths(cafe_slug: str) -> dict[str, Path]:
    safe_slug = cafe_slug.replace("/", "_")
    return {
        "model": SAVED_MODELS_DIR / f"lstm_demand_{safe_slug}.pt",
        "scaler": SAVED_MODELS_DIR / f"scaler_{safe_slug}.pkl",
        "metadata": SAVED_MODELS_DIR / f"metadata_{safe_slug}.json",
    }


def save_model_artifacts(
    cafe_slug: str,
    model: DemandLSTM,
    scaler: Any,
    metadata: dict[str, Any],
) -> dict[str, Path]:
    SAVED_MODELS_DIR.mkdir(parents=True, exist_ok=True)
    paths = model_paths(cafe_slug)
    torch.save(model.state_dict(), paths["model"])
    joblib.dump(scaler, paths["scaler"])
    with paths["metadata"].open("w", encoding="utf-8") as fh:
        json.dump(metadata, fh, indent=2, default=str)
    return paths


def load_model_artifacts(cafe_slug: str, model_path: str | None = None, scaler_path: str | None = None) -> tuple[DemandLSTM, Any, dict[str, Any]]:
    paths = model_paths(cafe_slug)
    resolved_model_path = Path(model_path) if model_path else paths["model"]
    resolved_scaler_path = Path(scaler_path) if scaler_path else paths["scaler"]
    metadata_path = paths["metadata"]

    with metadata_path.open("r", encoding="utf-8") as fh:
        metadata = json.load(fh)

    model = DemandLSTM(
        input_size=int(metadata["input_size"]),
        hidden_size=int(metadata.get("hidden_size", 128)),
        num_layers=int(metadata.get("num_layers", 2)),
        dropout=float(metadata.get("dropout", 0.2)),
    )
    model.load_state_dict(torch.load(resolved_model_path, map_location="cpu"))
    model.eval()
    scaler = joblib.load(resolved_scaler_path)
    return model, scaler, metadata


def predict_next_day(
    cafe_slug: str,
    db_config: dict[str, Any],
    model_path: str | None = None,
    scaler_path: str | None = None,
) -> dict[int, int]:
    from training.train_demand_model import prepare_prediction_sequences

    model, scaler, metadata = load_model_artifacts(cafe_slug, model_path, scaler_path)
    lookback_days = int(metadata.get("lookback_days", 14))
    dataset = prepare_prediction_sequences(cafe_slug, db_config, scaler, lookback_days, metadata)

    if dataset["X"].shape[0] == 0:
        raise ValueError("Not enough historical data to build prediction sequences.")

    with torch.no_grad():
        inputs = torch.tensor(dataset["X"], dtype=torch.float32)
        raw_predictions = model(inputs).numpy()

    predictions: dict[int, int] = {}
    rows: list[tuple[Any, ...]] = []
    forecast_date = dataset["forecast_date"]
    item_mape = metadata.get("item_mape", {})

    for idx, menu_item_id in enumerate(dataset["menu_item_ids"]):
        predicted_quantity = max(0, int(np.rint(raw_predictions[idx])))
        mape = float(item_mape.get(str(menu_item_id), metadata.get("overall_mape", 35.0)))
        confidence_score = round(max(0.05, min(0.98, 1.0 - (mape / 100.0))), 4)
        predictions[int(menu_item_id)] = predicted_quantity
        rows.append((cafe_slug, int(menu_item_id), forecast_date, predicted_quantity, confidence_score, "lstm_v1"))

    conn = psycopg2.connect(**db_config)
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM demand_forecasts WHERE cafe_slug = %s AND forecast_date = %s AND model_version = %s", (cafe_slug, forecast_date, "lstm_v1"))
            cur.executemany(
                """
                INSERT INTO demand_forecasts (
                    cafe_slug, menu_item_id, forecast_date, predicted_quantity,
                    confidence_score, model_version
                )
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                rows,
            )
        conn.commit()
    finally:
        conn.close()

    _print_prediction_summary(dataset, predictions, item_mape)
    return predictions


def _print_prediction_summary(dataset: dict[str, Any], predictions: dict[int, int], item_mape: dict[str, float]) -> None:
    forecast_date = dataset["forecast_date"]
    weather = dataset["weather"]
    calendar = dataset["calendar"]
    avg_7d = dataset["last_7d_average"]
    item_lookup = dataset["menu_items"]
    total_predicted = sum(predictions.values())
    total_avg = sum(avg_7d.values())
    predicted_revenue = sum(predictions[item_id] * float(item_lookup[item_id]["price"]) for item_id in predictions)

    print(f"\n=== Demand Forecast for {forecast_date} ({forecast_date.strftime('%A')}) ===")
    print(f"Weather: {weather['temperature_high']:.0f} C, {'Rain' if weather['is_rain'] else 'No rain'}")
    print(f"Holiday: {calendar.holiday_name or 'None'}")
    print(f"Day type: {'Weekend' if calendar.is_weekend else 'Weekday'}")
    print("\nItem                    | Predicted | Avg (last 7d) | Confidence")

    for item_id, predicted in sorted(predictions.items(), key=lambda row: row[1], reverse=True):
        item = item_lookup[item_id]
        confidence = max(0.05, min(0.98, 1.0 - (float(item_mape.get(str(item_id), 35.0)) / 100.0)))
        print(f"{item['name'][:23]:23} | {predicted:9d} | {avg_7d.get(item_id, 0):13.1f} | {confidence:.2f}")

    print(f"\nTotal predicted orders: {total_predicted} (vs 7-day avg: {total_avg:.0f})")
    print(f"Predicted revenue: INR {round(predicted_revenue, 2)}")
    print("Predictions saved to demand_forecasts table.")
