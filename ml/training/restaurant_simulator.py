from __future__ import annotations

import sys
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import psycopg2


ML_ROOT = Path(__file__).resolve().parents[1]
if str(ML_ROOT) not in sys.path:
    sys.path.insert(0, str(ML_ROOT))


OPTIMIZER_BUCKETS = {
    "dairy": {"Dairy"},
    "produce": {"Produce"},
    "proteins": {"Meat", "Protein"},
    "dry_goods": {"Dry Goods", "Bakery", "Spices", "Condiments", "Packaging"},
    "beverages": {"Beverages"},
}
STOCKOUT_EPSILON = 0.05


@dataclass
class InventoryBatch:
    quantity: float
    received_date: date
    expiry_date: date


@dataclass
class DayResult:
    day: date
    waste_cost: float = 0.0
    stockout_cost: float = 0.0
    purchase_cost: float = 0.0
    holding_cost: float = 0.0
    sales_revenue: float = 0.0
    reward: float = 0.0
    stockout_events: int = 0
    waste_events: int = 0
    ordered_quantities: dict[str, float] = field(default_factory=dict)


def optimizer_bucket(raw_category: str | None) -> str:
    category = raw_category or "Uncategorized"
    for bucket, categories in OPTIMIZER_BUCKETS.items():
        if category in categories:
            return bucket
    return "dry_goods"


class RestaurantSimulator:
    def __init__(
        self,
        cafe_slug: str,
        db_config: dict[str, Any],
        start_day_index: int = 28,
        end_day_index: int = 159,
        seed: int = 42,
    ):
        self.cafe_slug = cafe_slug
        self.db_config = db_config
        self.start_day_index = start_day_index
        self.end_day_index = end_day_index
        self.rng = np.random.default_rng(seed)
        self.data = load_simulation_data(cafe_slug, db_config)
        self.ingredients = self.data["ingredients"]
        self.recipes = self.data["recipes"]
        self.menu_items = self.data["menu_items"]
        self.daily_menu_sales = self.data["daily_menu_sales"]
        self.daily_ingredient_usage = self.data["daily_ingredient_usage"]
        self.daily_sales_revenue = self.data["daily_sales_revenue"]
        self.dates = self.data["dates"]
        self.max_cost_per_unit = max((row["cost_per_unit"] for row in self.ingredients.values()), default=1.0)
        self.avg_daily_usage = calculate_average_usage(self.ingredients, self.daily_ingredient_usage)
        self.ingredient_ids_by_bucket = group_ingredients_by_bucket(self.ingredients)
        self.debug_day_one = False
        self.reset()

    def reset(self) -> dict[str, list[float]]:
        self.current_idx = self.start_day_index
        self.inventory: dict[str, deque[InventoryBatch]] = {ingredient_id: deque() for ingredient_id in self.ingredients}
        self.pending_deliveries: list[dict[str, Any]] = []
        self.episode_results: list[DayResult] = []

        initial_day = self.dates[max(0, self.start_day_index - 1)]
        for ingredient_id, ingredient in self.ingredients.items():
            avg_usage = self.avg_daily_usage.get(ingredient_id, 0.0)
            shelf_life_days = self.usable_shelf_life_days(ingredient_id)
            initial_days = min(4.0, shelf_life_days)
            initial_quantity = max(avg_usage * initial_days, 0.0)
            if initial_quantity > 0:
                self._add_batch(ingredient_id, initial_quantity, initial_day)

        return self.get_all_bucket_states()

    def has_next_day(self) -> bool:
        return self.current_idx <= min(self.end_day_index, len(self.dates) - 1)

    def current_date(self) -> date:
        return self.dates[self.current_idx]

    def get_all_bucket_states(self) -> dict[str, list[float]]:
        current_day = self.current_date()
        return {
            bucket: self.get_bucket_state(bucket, current_day)
            for bucket in self.ingredient_ids_by_bucket
        }

    def get_bucket_state(self, bucket: str, current_day: date | None = None) -> list[float]:
        day = current_day or self.current_date()
        features: list[float] = []
        for ingredient_id in self.ingredient_ids_by_bucket[bucket]:
            features.extend(self.get_ingredient_features(ingredient_id, day))
        return features

    def get_ingredient_features(self, ingredient_id: str, current_day: date) -> list[float]:
        ingredient = self.ingredients[ingredient_id]
        current_stock = self.get_stock(ingredient_id)
        avg_usage = max(self.avg_daily_usage.get(ingredient_id, 0.0), 0.01)
        shelf_life_days = max(float(ingredient["shelf_life_hours"]) / 24.0, 1.0)
        nearest_expiry_days = self.days_until_nearest_expiry(ingredient_id, current_day)
        predicted_3d = self.predicted_ingredient_usage(ingredient_id, current_day, 3)

        return [
            min(current_stock / (avg_usage * 7.0), 2.0) / 2.0,
            min(max(nearest_expiry_days / shelf_life_days, 0.0), 1.0),
            min(predicted_3d / (avg_usage * 3.0), 2.0) / 2.0,
            min(float(ingredient["cost_per_unit"]) / self.max_cost_per_unit, 1.0),
            1.0 if float(ingredient["shelf_life_hours"]) < 120 else 0.0,
        ]

    def step(self, actions_by_ingredient: dict[str, int]) -> tuple[dict[str, list[float]], float, bool, DayResult]:
        current_day = self.current_date()
        result = DayResult(day=current_day)

        if self.debug_day_one and not self.episode_results:
            self._print_day_one_debug(actions_by_ingredient, current_day)
        self._receive_deliveries(current_day)
        result.purchase_cost += self._place_orders(actions_by_ingredient, current_day, result)
        self._receive_deliveries(current_day)
        stockout_cost, stockout_events = self._consume_for_day(current_day)
        result.stockout_cost = stockout_cost
        result.stockout_events = stockout_events
        waste_cost, waste_events = self._expire_batches(current_day)
        result.waste_cost = waste_cost
        result.waste_events = waste_events
        result.holding_cost = self._holding_cost()
        result.sales_revenue = self.daily_sales_revenue.get(current_day, 0.0)
        result.reward = calculate_reward(result)
        if self.debug_day_one and not self.episode_results:
            self._print_day_one_result_debug(result)
        self.episode_results.append(result)

        self.current_idx += 1
        done = not self.has_next_day()
        next_state = self.get_all_bucket_states() if not done else self._terminal_states()
        return next_state, result.reward, done, result

    def action_to_quantity(self, ingredient_id: str, action: int, current_day: date) -> float:
        ingredient = self.ingredients[ingredient_id]
        min_order_quantity = self.order_floor(ingredient_id)
        if action == 0:
            return 0.0
        if action == 1:
            demand = self.predicted_ingredient_usage(ingredient_id, current_day, 1)
            available = self.get_stock(ingredient_id) + self.pending_quantity(ingredient_id, current_day, 1)
            needed = max(demand - available, 0.0)
            if needed <= 0:
                return 0.0
            return round(max(needed, min_order_quantity), 1)
        requested_horizon = {2: 3, 3: 5, 4: 7}.get(action, 3)
        horizon = min(requested_horizon, self.usable_shelf_life_days(ingredient_id))
        demand = self.predicted_ingredient_usage(ingredient_id, current_day, horizon)
        available = self.get_stock(ingredient_id) + self.pending_quantity(ingredient_id, current_day, horizon)
        needed = max(demand - available, 0.0)
        if needed <= 0:
            return 0.0
        return round(max(needed, min_order_quantity), 1)

    def predicted_ingredient_usage(self, ingredient_id: str, current_day: date, horizon_days: float) -> float:
        total = 0.0
        whole_days = max(1, int(np.ceil(horizon_days)))
        for offset in range(whole_days):
            day = current_day + timedelta(days=offset)
            total += self.daily_ingredient_usage.get(day, {}).get(ingredient_id, 0.0)
        if total <= 0:
            total = self.avg_daily_usage.get(ingredient_id, 0.0) * horizon_days
        return float(total)

    def get_stock(self, ingredient_id: str) -> float:
        return float(sum(batch.quantity for batch in self.inventory[ingredient_id]))

    def usable_shelf_life_days(self, ingredient_id: str) -> float:
        ingredient = self.ingredients[ingredient_id]
        return max(float(ingredient["shelf_life_hours"]) / 24.0, 1.0)

    def order_floor(self, ingredient_id: str) -> float:
        ingredient = self.ingredients[ingredient_id]
        min_order_quantity = float(ingredient["min_order_quantity"] or 1.0)
        shelf_life_days = self.usable_shelf_life_days(ingredient_id)
        if shelf_life_days < 7.0:
            usable_quantity = self.avg_daily_usage.get(ingredient_id, 0.0) * shelf_life_days
            return max(0.0, min(min_order_quantity, usable_quantity))
        return min_order_quantity

    def pending_quantity(self, ingredient_id: str, current_day: date, horizon_days: float | None = None) -> float:
        horizon_end = current_day + timedelta(days=horizon_days) if horizon_days is not None else None
        return float(
            sum(
                delivery["quantity"]
                for delivery in self.pending_deliveries
                if delivery["ingredient_id"] == ingredient_id
                and (horizon_end is None or delivery["arrival_date"] <= horizon_end)
            )
        )

    def days_until_nearest_expiry(self, ingredient_id: str, current_day: date) -> float:
        batches = [batch for batch in self.inventory[ingredient_id] if batch.quantity > 0]
        if not batches:
            return 0.0
        return float(max(0, min((batch.expiry_date - current_day).days for batch in batches)))

    def _terminal_states(self) -> dict[str, list[float]]:
        return {
            bucket: [0.0] * (len(ingredient_ids) * 5)
            for bucket, ingredient_ids in self.ingredient_ids_by_bucket.items()
        }

    def _add_batch(self, ingredient_id: str, quantity: float, received_date: date) -> None:
        ingredient = self.ingredients[ingredient_id]
        shelf_life_days = max(1, int(round(float(ingredient["shelf_life_hours"]) / 24.0)))
        self.inventory[ingredient_id].append(
            InventoryBatch(
                quantity=round(float(quantity), 3),
                received_date=received_date,
                expiry_date=received_date + timedelta(days=shelf_life_days),
            )
        )

    def _receive_deliveries(self, current_day: date) -> None:
        remaining = []
        for delivery in self.pending_deliveries:
            if delivery["arrival_date"] <= current_day:
                self._add_batch(delivery["ingredient_id"], delivery["quantity"], current_day)
            else:
                remaining.append(delivery)
        self.pending_deliveries = remaining

    def _place_orders(self, actions_by_ingredient: dict[str, int], current_day: date, result: DayResult) -> float:
        purchase_cost = 0.0
        for ingredient_id, action in actions_by_ingredient.items():
            quantity = self.action_to_quantity(ingredient_id, action, current_day)
            if quantity <= 0:
                continue
            ingredient = self.ingredients[ingredient_id]
            lead_time_days = 0
            self.pending_deliveries.append(
                {
                    "ingredient_id": ingredient_id,
                    "quantity": quantity,
                    "arrival_date": current_day + timedelta(days=lead_time_days),
                }
            )
            purchase_cost += quantity * float(ingredient["cost_per_unit"])
            result.ordered_quantities[ingredient_id] = quantity
        return round(purchase_cost, 2)

    def _consume_for_day(self, current_day: date) -> tuple[float, int]:
        usage = self.daily_ingredient_usage.get(current_day, {})
        stockout_cost = 0.0
        stockout_events = 0

        for ingredient_id, needed in usage.items():
            remaining = float(needed)
            batches = self.inventory[ingredient_id]
            while remaining > 0 and batches:
                batch = batches[0]
                used = min(batch.quantity, remaining)
                batch.quantity -= used
                remaining -= used
                if batch.quantity <= 0.0001:
                    batches.popleft()
            if remaining > STOCKOUT_EPSILON:
                ingredient = self.ingredients[ingredient_id]
                stockout_events += 1
                stockout_cost += remaining * float(ingredient["cost_per_unit"]) * 4.0

        return round(stockout_cost, 2), stockout_events

    def _expire_batches(self, current_day: date) -> tuple[float, int]:
        waste_cost = 0.0
        waste_events = 0
        for ingredient_id, batches in self.inventory.items():
            ingredient = self.ingredients[ingredient_id]
            remaining_batches = deque()
            while batches:
                batch = batches.popleft()
                if batch.expiry_date <= current_day and batch.quantity > 0:
                    waste_cost += batch.quantity * float(ingredient["cost_per_unit"])
                    waste_events += 1
                elif batch.quantity > 0:
                    remaining_batches.append(batch)
            self.inventory[ingredient_id] = remaining_batches
        return round(waste_cost, 2), waste_events

    def _holding_cost(self) -> float:
        cost = 0.0
        for ingredient_id, batches in self.inventory.items():
            ingredient = self.ingredients[ingredient_id]
            cost += sum(batch.quantity for batch in batches) * float(ingredient["cost_per_unit"]) * 0.001
        return round(cost, 2)

    def _debug_sample_ingredient_ids(self) -> list[str]:
        active_ids = [ingredient_id for ingredient_id, usage in self.avg_daily_usage.items() if usage > 0]
        return active_ids[:5] or list(self.ingredients)[:5]

    def _print_day_one_debug(self, actions_by_ingredient: dict[str, int], current_day: date) -> None:
        print("\n=== Simulator day-one scaling debug ===")
        for ingredient_id in self._debug_sample_ingredient_ids():
            ingredient = self.ingredients[ingredient_id]
            action_quantities = {
                action: self.action_to_quantity(ingredient_id, action, current_day)
                for action in range(5)
            }
            print(
                f"{ingredient['name']} | initial={self.get_stock(ingredient_id):.3f} {ingredient['unit']} | "
                f"avg_daily_usage={self.avg_daily_usage.get(ingredient_id, 0.0):.3f} | "
                f"day_usage={self.daily_ingredient_usage.get(current_day, {}).get(ingredient_id, 0.0):.3f} | "
                f"actions={action_quantities} | selected={actions_by_ingredient.get(ingredient_id, 0)}"
            )

    def _print_day_one_result_debug(self, result: DayResult) -> None:
        print(
            "Day-one result | "
            f"waste=INR {result.waste_cost:.2f} | "
            f"stockout_cost=INR {result.stockout_cost:.2f} | "
            f"purchase=INR {result.purchase_cost:.2f} | "
            f"revenue=INR {result.sales_revenue:.2f} | "
            f"reward={result.reward:.4f}"
        )


def calculate_reward(day_result: DayResult) -> float:
    reward = -(
        day_result.waste_cost * 3.0
        + day_result.stockout_cost * 2.0
        + day_result.purchase_cost * 0.1
        + day_result.holding_cost * 0.5
    )
    if day_result.purchase_cost > 0 and day_result.sales_revenue > 0:
        food_cost_pct = day_result.purchase_cost / day_result.sales_revenue
        if 0.28 <= food_cost_pct <= 0.35:
            reward += 500.0
    return round(float(reward) / 1000.0, 4)


def load_simulation_data(cafe_slug: str, db_config: dict[str, Any]) -> dict[str, Any]:
    conn = psycopg2.connect(**db_config)
    try:
        restaurant_df = pd.read_sql_query("SELECT id FROM restaurants WHERE domain = %s", conn, params=(cafe_slug,))
        if restaurant_df.empty:
            raise ValueError(f"Restaurant not found for domain={cafe_slug}")
        restaurant_id = int(restaurant_df.iloc[0]["id"])

        ingredients_df = pd.read_sql_query(
            """
            SELECT id, name, category, unit, cost_per_unit, shelf_life_hours, storage_type, min_order_quantity
            FROM ingredients
            WHERE cafe_slug = %s AND is_active = true
            ORDER BY name
            """,
            conn,
            params=(cafe_slug,),
        )
        recipes_df = pd.read_sql_query(
            """
            SELECT menu_item_id, ingredient_id, quantity_used, unit
            FROM recipe_ingredients
            WHERE ingredient_id IN (
                SELECT id FROM ingredients WHERE cafe_slug = %s AND is_active = true
            )
            """,
            conn,
            params=(cafe_slug,),
        )
        menu_df = pd.read_sql_query(
            """
            SELECT id, name, price, COALESCE(category, 'Uncategorized') AS category
            FROM menus
            WHERE restaurant_id = %s
            ORDER BY id
            """,
            conn,
            params=(restaurant_id,),
        )
        sales_df = pd.read_sql_query(
            """
            SELECT oi.menu_item_id, DATE(o.created_at) AS sale_date, SUM(oi.quantity)::float AS units_sold
            FROM order_items oi
            JOIN orders o ON o.id = oi.order_id
            WHERE o.restaurant_id = %s
            GROUP BY oi.menu_item_id, DATE(o.created_at)
            ORDER BY sale_date
            """,
            conn,
            params=(restaurant_id,),
        )
    finally:
        conn.close()

    if ingredients_df.empty or recipes_df.empty or menu_df.empty or sales_df.empty:
        raise ValueError("Simulator requires ingredients, recipes, menu items, and order_items sales data.")

    sales_df["sale_date"] = pd.to_datetime(sales_df["sale_date"]).dt.date
    min_date = sales_df["sale_date"].min()
    max_date = sales_df["sale_date"].max()
    dates = list(pd.date_range(min_date, max_date, freq="D").date)

    ingredients = {
        str(row.id): {
            "id": str(row.id),
            "name": str(row.name),
            "category": str(row.category),
            "bucket": optimizer_bucket(str(row.category)),
            "unit": str(row.unit),
            "cost_per_unit": float(row.cost_per_unit),
            "shelf_life_hours": float(row.shelf_life_hours or 720),
            "storage_type": str(row.storage_type or "dry"),
            "min_order_quantity": float(row.min_order_quantity or 1.0),
        }
        for row in ingredients_df.itertuples(index=False)
    }
    menu_items = {
        int(row.id): {
            "id": int(row.id),
            "name": str(row.name),
            "price": float(row.price),
            "category": str(row.category),
        }
        for row in menu_df.itertuples(index=False)
    }
    recipes: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in recipes_df.itertuples(index=False):
        recipes[int(row.menu_item_id)].append(
            {
                "ingredient_id": str(row.ingredient_id),
                "quantity_used": float(row.quantity_used),
                "unit": str(row.unit),
            }
        )

    daily_menu_sales: dict[date, dict[int, float]] = defaultdict(dict)
    for row in sales_df.itertuples(index=False):
        daily_menu_sales[row.sale_date][int(row.menu_item_id)] = float(row.units_sold)

    daily_ingredient_usage: dict[date, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for sale_day, menu_sales in daily_menu_sales.items():
        for menu_item_id, units_sold in menu_sales.items():
            for recipe_row in recipes.get(menu_item_id, []):
                daily_ingredient_usage[sale_day][recipe_row["ingredient_id"]] += units_sold * recipe_row["quantity_used"]

    daily_ingredient_usage = {
        sale_day: {ingredient_id: round(quantity, 4) for ingredient_id, quantity in usage.items()}
        for sale_day, usage in daily_ingredient_usage.items()
    }
    daily_sales_revenue = {
        sale_day: round(
            sum(units_sold * menu_items[menu_item_id]["price"] for menu_item_id, units_sold in menu_sales.items()),
            2,
        )
        for sale_day, menu_sales in daily_menu_sales.items()
    }

    return {
        "ingredients": ingredients,
        "recipes": recipes,
        "menu_items": menu_items,
        "daily_menu_sales": daily_menu_sales,
        "daily_ingredient_usage": daily_ingredient_usage,
        "daily_sales_revenue": daily_sales_revenue,
        "dates": dates,
    }


def calculate_average_usage(ingredients: dict[str, dict[str, Any]], daily_usage: dict[date, dict[str, float]]) -> dict[str, float]:
    day_count = max(len(daily_usage), 1)
    totals = {ingredient_id: 0.0 for ingredient_id in ingredients}
    for usage in daily_usage.values():
        for ingredient_id, quantity in usage.items():
            totals[ingredient_id] = totals.get(ingredient_id, 0.0) + float(quantity)
    return {ingredient_id: totals.get(ingredient_id, 0.0) / day_count for ingredient_id in ingredients}


def group_ingredients_by_bucket(ingredients: dict[str, dict[str, Any]]) -> dict[str, list[str]]:
    grouped: dict[str, list[str]] = {bucket: [] for bucket in OPTIMIZER_BUCKETS}
    for ingredient_id, ingredient in ingredients.items():
        grouped[ingredient["bucket"]].append(ingredient_id)
    return {bucket: sorted(ids, key=lambda ingredient_id: ingredients[ingredient_id]["name"]) for bucket, ids in grouped.items() if ids}
