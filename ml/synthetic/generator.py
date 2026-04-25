from __future__ import annotations

import argparse
import json
from datetime import date, datetime, timedelta
from typing import Any

import numpy as np
import psycopg2
from dateutil.parser import isoparse
from psycopg2.extras import execute_values

from config import DB_CONFIG, RANDOM_SEED, START_DATE, SYNTHETIC_CAFE_SLUG, SYNTHETIC_DAYS
from synthetic.demand_simulator import simulate_demand
from synthetic.inventory_simulator import simulate_inventory
from synthetic.menu_factory import build_menu_and_ingredients


def run_generator(days: int = SYNTHETIC_DAYS, start_date: str = START_DATE, cafe_slug: str = SYNTHETIC_CAFE_SLUG, seed: int = RANDOM_SEED) -> None:
    rng = np.random.default_rng(seed)
    parsed_start = isoparse(start_date).date()

    print(f"Connecting to PostgreSQL database {DB_CONFIG['database']} on {DB_CONFIG['host']}...")
    conn = psycopg2.connect(**DB_CONFIG)
    conn.autocommit = False

    try:
        with conn.cursor() as cur:
            print("Ensuring generator-owned setup tables exist...")
            ensure_inventory_snapshots_table(cur)
            ensure_ml_output_tables(cur)

            print(f"Deleting old synthetic data for domain={cafe_slug}...")
            cleanup_existing_synthetic_data(cur, cafe_slug)

            print("Creating synthetic restaurant...")
            restaurant_id = create_restaurant(cur, cafe_slug)

            print("Building Bangalore cafe menu, ingredients, and recipes...")
            menu_items, ingredients, recipes = build_menu_and_ingredients(rng)
            menu_name_to_id = insert_menu_items(cur, restaurant_id, menu_items)
            ingredient_name_to_id = insert_ingredients(cur, cafe_slug, ingredients)
            insert_recipes(cur, menu_name_to_id, ingredient_name_to_id, ingredients, recipes)

            print(f"Simulating {days} days of demand...")
            orders, order_items, weather_by_day = simulate_demand(parsed_start, days, menu_items, rng)
            attach_menu_ids_to_order_json(orders, menu_name_to_id)
            order_ref_to_id = insert_orders(cur, restaurant_id, orders)
            insert_order_items(cur, order_items, order_ref_to_id, menu_name_to_id)

            print("Simulating inventory movement and waste...")
            snapshots, waste_logs, daily_consumption = simulate_inventory(parsed_start, days, ingredients, recipes, order_items, rng)
            insert_inventory_snapshots(cur, cafe_slug, snapshots, ingredient_name_to_id)
            insert_waste_logs(cur, cafe_slug, waste_logs, ingredient_name_to_id)

            print("Writing starter ML output examples...")
            insert_ml_output_examples(cur, cafe_slug, parsed_start, menu_name_to_id, ingredient_name_to_id, menu_items, ingredients, daily_consumption)

        conn.commit()
        print_summary(cafe_slug, menu_items, ingredients, recipes, orders, order_items, snapshots, waste_logs, weather_by_day)
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def ensure_inventory_snapshots_table(cur: Any) -> None:
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS inventory_snapshots (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            cafe_slug VARCHAR(255) NOT NULL,
            ingredient_id UUID NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
            quantity_on_hand NUMERIC(10,2) NOT NULL,
            recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            recorded_by VARCHAR(255)
        )
        """
    )
    cur.execute("CREATE INDEX IF NOT EXISTS idx_inventory_snapshots_slug_recorded_at ON inventory_snapshots(cafe_slug, recorded_at)")


def ensure_ml_output_tables(cur: Any) -> None:
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS demand_forecasts (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            cafe_slug VARCHAR(255) NOT NULL,
            menu_item_id INTEGER REFERENCES menus(id) ON DELETE CASCADE,
            forecast_date DATE NOT NULL,
            predicted_quantity NUMERIC(10,2) NOT NULL,
            actual_quantity NUMERIC(10,2),
            confidence_score NUMERIC(5,4),
            model_version VARCHAR(50),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    cur.execute("CREATE INDEX IF NOT EXISTS idx_demand_forecasts_slug_date ON demand_forecasts(cafe_slug, forecast_date)")
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS purchase_recommendations (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            cafe_slug VARCHAR(255) NOT NULL,
            ingredient_id UUID REFERENCES ingredients(id) ON DELETE CASCADE,
            recommendation_date DATE NOT NULL,
            recommended_quantity NUMERIC(10,2) NOT NULL,
            estimated_cost NUMERIC(10,2) NOT NULL,
            reason TEXT,
            status VARCHAR(50) DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    cur.execute("CREATE INDEX IF NOT EXISTS idx_purchase_recs_slug_date ON purchase_recommendations(cafe_slug, recommendation_date)")


def cleanup_existing_synthetic_data(cur: Any, cafe_slug: str) -> None:
    cur.execute("SELECT id FROM restaurants WHERE domain = %s", (cafe_slug,))
    row = cur.fetchone()
    restaurant_id = row[0] if row else None

    cur.execute("DELETE FROM demand_forecasts WHERE cafe_slug = %s", (cafe_slug,))
    cur.execute("DELETE FROM purchase_recommendations WHERE cafe_slug = %s", (cafe_slug,))
    cur.execute("DELETE FROM waste_log WHERE cafe_slug = %s", (cafe_slug,))
    cur.execute("DELETE FROM inventory_snapshots WHERE cafe_slug = %s", (cafe_slug,))

    if restaurant_id is not None:
        cur.execute("DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE restaurant_id = %s)", (restaurant_id,))
        cur.execute("DELETE FROM orders WHERE restaurant_id = %s", (restaurant_id,))
        cur.execute("DELETE FROM recipe_ingredients WHERE menu_item_id IN (SELECT id FROM menus WHERE restaurant_id = %s)", (restaurant_id,))
        cur.execute("DELETE FROM menus WHERE restaurant_id = %s", (restaurant_id,))
        cur.execute("DELETE FROM upsell_events WHERE restaurant_slug = %s", (cafe_slug,))
        cur.execute("DELETE FROM restaurants WHERE id = %s", (restaurant_id,))

    cur.execute("DELETE FROM ingredients WHERE cafe_slug = %s", (cafe_slug,))


def create_restaurant(cur: Any, cafe_slug: str) -> int:
    cur.execute(
        """
        INSERT INTO restaurants (name, domain)
        VALUES (%s, %s)
        RETURNING id
        """,
        ("Synthetic Bangalore Cafe", cafe_slug),
    )
    return int(cur.fetchone()[0])


def insert_menu_items(cur: Any, restaurant_id: int, menu_items: list[dict[str, Any]]) -> dict[str, int]:
    rows = [
        (
            restaurant_id,
            item["name"],
            item["description"],
            round(item["price"], 2),
            item["category"],
            item["sub_category"],
            item["tags"],
            True,
        )
        for item in menu_items
    ]
    result = execute_values(
        cur,
        """
        INSERT INTO menus (restaurant_id, name, description, price, category, sub_category, tags, is_available)
        VALUES %s
        RETURNING id, name
        """,
        rows,
        fetch=True,
    )
    return {name: int(menu_id) for menu_id, name in result}


def insert_ingredients(cur: Any, cafe_slug: str, ingredients: list[dict[str, Any]]) -> dict[str, str]:
    rows = [
        (
            cafe_slug,
            ingredient["name"],
            ingredient["category"],
            ingredient["unit"],
            round(ingredient["cost_per_unit"], 2),
            ingredient["shelf_life_hours"],
            ingredient["storage_type"],
            ingredient["supplier_name"],
            round(ingredient["min_order_quantity"], 2),
            True,
        )
        for ingredient in ingredients
    ]
    result = execute_values(
        cur,
        """
        INSERT INTO ingredients (
            cafe_slug, name, category, unit, cost_per_unit, shelf_life_hours,
            storage_type, supplier_name, min_order_quantity, is_active
        )
        VALUES %s
        RETURNING id, name
        """,
        rows,
        fetch=True,
    )
    return {name: str(ingredient_id) for ingredient_id, name in result}


def insert_recipes(
    cur: Any,
    menu_name_to_id: dict[str, int],
    ingredient_name_to_id: dict[str, str],
    ingredients: list[dict[str, Any]],
    recipes: dict[str, list[dict[str, Any]]],
) -> None:
    ingredient_unit = {ingredient["name"]: ingredient["unit"] for ingredient in ingredients}
    rows = []
    for menu_name, recipe_rows in recipes.items():
        for recipe in recipe_rows:
            ingredient_name = recipe["ingredient_name"]
            rows.append(
                (
                    menu_name_to_id[menu_name],
                    ingredient_name_to_id[ingredient_name],
                    round(recipe["quantity_used"], 4),
                    ingredient_unit[ingredient_name],
                )
            )
    execute_values(
        cur,
        """
        INSERT INTO recipe_ingredients (menu_item_id, ingredient_id, quantity_used, unit)
        VALUES %s
        """,
        rows,
    )


def attach_menu_ids_to_order_json(orders: list[dict[str, Any]], menu_name_to_id: dict[str, int]) -> None:
    for order in orders:
        for item in order["items_json"]:
            item["menu_item_id"] = menu_name_to_id[item["name"]]


def insert_orders(cur: Any, restaurant_id: int, orders: list[dict[str, Any]]) -> dict[int, int]:
    rows = [
        (
            restaurant_id,
            json.dumps(order["items_json"]),
            round(order["total"], 2),
            order["customer_name"],
            order["customer_phone"],
            order["status"],
            order["created_at"],
            order["table_number"],
            order["pairing_accepted"],
            order["upsell_value"],
        )
        for order in orders
    ]
    result = execute_values(
        cur,
        """
        INSERT INTO orders (
            restaurant_id, items, total, customer_name, customer_phone, status,
            created_at, table_number, pairing_accepted, upsell_value
        )
        VALUES %s
        RETURNING id
        """,
        rows,
        page_size=1000,
        fetch=True,
    )
    ids = [int(row[0]) for row in result]
    return {order["order_ref"]: order_id for order, order_id in zip(orders, ids)}


def insert_order_items(
    cur: Any,
    order_items: list[dict[str, Any]],
    order_ref_to_id: dict[int, int],
    menu_name_to_id: dict[str, int],
) -> None:
    rows = [
        (
            order_ref_to_id[item["order_ref"]],
            menu_name_to_id[item["menu_name"]],
            item["menu_name"],
            int(item["quantity"]),
            round(item["unit_price"], 2),
            item["created_at"],
        )
        for item in order_items
    ]
    execute_values(
        cur,
        """
        INSERT INTO order_items (order_id, menu_item_id, item_name, quantity, unit_price, created_at)
        VALUES %s
        """,
        rows,
        page_size=5000,
    )


def insert_inventory_snapshots(cur: Any, cafe_slug: str, snapshots: list[dict[str, Any]], ingredient_name_to_id: dict[str, str]) -> None:
    rows = [
        (
            cafe_slug,
            ingredient_name_to_id[snapshot["ingredient_name"]],
            round(snapshot["quantity_on_hand"], 2),
            snapshot["recorded_at"],
            snapshot["recorded_by"],
        )
        for snapshot in snapshots
    ]
    execute_values(
        cur,
        """
        INSERT INTO inventory_snapshots (cafe_slug, ingredient_id, quantity_on_hand, recorded_at, recorded_by)
        VALUES %s
        """,
        rows,
        page_size=5000,
    )


def insert_waste_logs(cur: Any, cafe_slug: str, waste_logs: list[dict[str, Any]], ingredient_name_to_id: dict[str, str]) -> None:
    rows = [
        (
            cafe_slug,
            ingredient_name_to_id[waste["ingredient_name"]],
            round(waste["quantity_wasted"], 2),
            waste["reason"],
            round(waste["cost_value"], 2),
            waste["notes"],
            waste["logged_at"],
            waste["logged_by"],
        )
        for waste in waste_logs
    ]
    if not rows:
        return
    execute_values(
        cur,
        """
        INSERT INTO waste_log (
            cafe_slug, ingredient_id, quantity_wasted, reason, cost_value,
            notes, logged_at, logged_by
        )
        VALUES %s
        """,
        rows,
        page_size=5000,
    )


def insert_ml_output_examples(
    cur: Any,
    cafe_slug: str,
    start_date: date,
    menu_name_to_id: dict[str, int],
    ingredient_name_to_id: dict[str, str],
    menu_items: list[dict[str, Any]],
    ingredients: list[dict[str, Any]],
    daily_consumption: dict[date, dict[str, float]],
) -> None:
    forecast_rows = []
    for item in menu_items[:12]:
        for offset in range(7):
            forecast_rows.append(
                (
                    cafe_slug,
                    menu_name_to_id[item["name"]],
                    start_date + timedelta(days=offset),
                    round(float(item["popularity"]) * (18 + offset * 0.8), 2),
                    None,
                    round(0.72 + offset * 0.015, 4),
                    "synthetic-baseline-v0",
                )
            )

    execute_values(
        cur,
        """
        INSERT INTO demand_forecasts (
            cafe_slug, menu_item_id, forecast_date, predicted_quantity,
            actual_quantity, confidence_score, model_version
        )
        VALUES %s
        """,
        forecast_rows,
    )

    last_consumption_day = max(daily_consumption)
    consumption = daily_consumption[last_consumption_day]
    ingredient_cost = {ingredient["name"]: ingredient["cost_per_unit"] for ingredient in ingredients}
    rec_rows = []
    for ingredient_name, quantity in sorted(consumption.items(), key=lambda pair: pair[1], reverse=True)[:20]:
        recommended_quantity = round(max(quantity * 3.0, 1.0), 2)
        estimated_cost = round(recommended_quantity * ingredient_cost[ingredient_name], 2)
        rec_rows.append(
            (
                cafe_slug,
                ingredient_name_to_id[ingredient_name],
                last_consumption_day,
                recommended_quantity,
                estimated_cost,
                "Synthetic baseline using last-day consumption x 3 days",
                "pending",
            )
        )

    execute_values(
        cur,
        """
        INSERT INTO purchase_recommendations (
            cafe_slug, ingredient_id, recommendation_date, recommended_quantity,
            estimated_cost, reason, status
        )
        VALUES %s
        """,
        rec_rows,
    )


def print_summary(
    cafe_slug: str,
    menu_items: list[dict[str, Any]],
    ingredients: list[dict[str, Any]],
    recipes: dict[str, list[dict[str, Any]]],
    orders: list[dict[str, Any]],
    order_items: list[dict[str, Any]],
    snapshots: list[dict[str, Any]],
    waste_logs: list[dict[str, Any]],
    weather_by_day: dict[date, Any],
) -> None:
    revenue = round(sum(order["total"] for order in orders), 2)
    aov = round(revenue / len(orders), 2) if orders else 0
    rain_days = sum(1 for weather in weather_by_day.values() if weather.rain_mm > 0)
    total_waste_cost = round(sum(waste["cost_value"] for waste in waste_logs), 2)

    print("\nSynthetic data generation complete")
    print(f"Cafe domain: {cafe_slug}")
    print(f"Menu items: {len(menu_items)}")
    print(f"Ingredients: {len(ingredients)}")
    print(f"Recipe mappings: {sum(len(rows) for rows in recipes.values())}")
    print(f"Orders: {len(orders)}")
    print(f"Order items: {len(order_items)}")
    print(f"Inventory snapshots: {len(snapshots)}")
    print(f"Waste logs: {len(waste_logs)}")
    print(f"Revenue: INR {revenue}")
    print(f"AOV: INR {aov}")
    print(f"Rain days: {rain_days}")
    print(f"Total waste cost: INR {total_waste_cost}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Bangalore-specific synthetic Orlena cafe data.")
    parser.add_argument("--days", type=int, default=SYNTHETIC_DAYS)
    parser.add_argument("--start-date", default=START_DATE)
    parser.add_argument("--cafe-slug", default=SYNTHETIC_CAFE_SLUG)
    parser.add_argument("--seed", type=int, default=RANDOM_SEED)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    run_generator(days=args.days, start_date=args.start_date, cafe_slug=args.cafe_slug, seed=args.seed)


if __name__ == "__main__":
    main()
