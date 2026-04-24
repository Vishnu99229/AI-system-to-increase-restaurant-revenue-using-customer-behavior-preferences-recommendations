from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Any

import numpy as np

from synthetic.bangalore_calendar import TIME_OF_DAY_WEIGHTS, get_calendar_effects
from synthetic.weather_data import WeatherDay, generate_weather_for_day


def simulate_demand(
    start_date: date,
    days: int,
    menu_items: list[dict[str, Any]],
    rng: np.random.Generator,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[date, WeatherDay]]:
    orders: list[dict[str, Any]] = []
    order_items: list[dict[str, Any]] = []
    weather_by_day: dict[date, WeatherDay] = {}

    for offset in range(days):
        day = start_date + timedelta(days=offset)
        calendar = get_calendar_effects(day)
        weather = generate_weather_for_day(day, rng)
        weather_by_day[day] = weather

        if calendar.is_weekend:
            base_orders = int(rng.integers(130, 181))
        else:
            base_orders = int(rng.integers(80, 121))

        noisy_multiplier = float(rng.normal(1.0, 0.08))
        order_count = max(45, int(round(base_orders * calendar.daily_multiplier * weather.demand_multiplier * noisy_multiplier)))

        for order_number in range(order_count):
            daypart = _sample_daypart(rng)
            order_time = _sample_order_time(day, daypart, rng)
            group_size = _sample_group_size(daypart, calendar.is_weekend, rng)
            items = _sample_items_for_order(menu_items, daypart, group_size, weather, rng)
            subtotal = round(sum(item["price"] * item["quantity"] for item in items), 2)

            pairing_accepted = rng.random() < _upsell_probability(subtotal, daypart)
            upsell_value = 0
            if pairing_accepted:
                upsell = _choose_upsell(menu_items, items, daypart, rng)
                if upsell:
                    items.append(upsell)
                    upsell_value = round(upsell["price"], 2)
                    subtotal = round(subtotal + upsell_value, 2)

            order_ref = len(orders)
            orders.append(
                {
                    "order_ref": order_ref,
                    "created_at": order_time,
                    "items_json": [
                        {
                            "menu_item_id": None,
                            "name": item["name"],
                            "quantity": item["quantity"],
                            "price": round(item["price"], 2),
                            "is_upsell": item.get("is_upsell", False),
                        }
                        for item in items
                    ],
                    "total": round(subtotal, 2),
                    "customer_name": _customer_name(order_ref),
                    "customer_phone": _customer_phone(order_ref),
                    "pairing_accepted": pairing_accepted,
                    "table_number": str(int(rng.integers(1, 16))),
                    "upsell_value": int(round(upsell_value)),
                    "status": "completed",
                    "daypart": daypart,
                }
            )

            for item in items:
                order_items.append(
                    {
                        "order_ref": order_ref,
                        "menu_name": item["name"],
                        "quantity": item["quantity"],
                        "unit_price": round(item["price"], 2),
                        "created_at": order_time,
                    }
                )

    return orders, order_items, weather_by_day


def _sample_daypart(rng: np.random.Generator) -> str:
    names = list(TIME_OF_DAY_WEIGHTS.keys())
    weights = np.array([TIME_OF_DAY_WEIGHTS[name]["weight"] for name in names], dtype=float)
    weights = weights / weights.sum()
    return str(rng.choice(names, p=weights))


def _sample_order_time(day: date, daypart: str, rng: np.random.Generator) -> datetime:
    profile = TIME_OF_DAY_WEIGHTS[daypart]
    hour = int(rng.integers(profile["start"], profile["end"] + 1))
    minute = int(rng.integers(0, 60))
    second = int(rng.integers(0, 60))
    return datetime.combine(day, time(hour, minute, second))


def _sample_group_size(daypart: str, is_weekend: bool, rng: np.random.Generator) -> int:
    if daypart == "breakfast":
        probabilities = [0.62, 0.28, 0.08, 0.02]
    elif is_weekend:
        probabilities = [0.34, 0.38, 0.18, 0.10]
    else:
        probabilities = [0.48, 0.34, 0.13, 0.05]
    return int(rng.choice([1, 2, 3, 4], p=probabilities))


def _sample_items_for_order(
    menu_items: list[dict[str, Any]],
    daypart: str,
    group_size: int,
    weather: WeatherDay,
    rng: np.random.Generator,
) -> list[dict[str, Any]]:
    item_count = max(1, int(rng.poisson(1.15 + (group_size - 1) * 0.55)))
    selected: list[dict[str, Any]] = []

    for _ in range(item_count):
        item = _weighted_menu_choice(menu_items, daypart, weather, rng)
        selected.append({"name": item["name"], "price": item["price"], "quantity": 1})

    # Beverages commonly attach to food orders, especially breakfast and snack.
    if rng.random() < (0.46 if daypart in {"breakfast", "snack"} else 0.28):
        beverages = [item for item in menu_items if item["category"] == "Beverages"]
        drink = _weighted_menu_choice(beverages, daypart, weather, rng)
        selected.append({"name": drink["name"], "price": drink["price"], "quantity": 1})

    compact: dict[str, dict[str, Any]] = {}
    for item in selected:
        if item["name"] not in compact:
            compact[item["name"]] = item.copy()
        else:
            compact[item["name"]]["quantity"] += 1
    return list(compact.values())


def _weighted_menu_choice(menu_items: list[dict[str, Any]], daypart: str, weather: WeatherDay, rng: np.random.Generator) -> dict[str, Any]:
    weights = []
    for item in menu_items:
        weight = float(item["popularity"])
        if daypart in item["dayparts"]:
            weight *= 1.75
        else:
            weight *= 0.42
        if item["weather_affinity"] == "cold":
            weight *= weather.cold_beverage_multiplier
        elif item["weather_affinity"] == "hot":
            weight *= weather.hot_beverage_multiplier
        if item["price"] > 300:
            weight *= 0.84
        elif item["price"] < 150:
            weight *= 1.08
        weights.append(weight)

    weights_array = np.array(weights, dtype=float)
    weights_array = weights_array / weights_array.sum()
    idx = int(rng.choice(len(menu_items), p=weights_array))
    return menu_items[idx]


def _upsell_probability(subtotal: float, daypart: str) -> float:
    base = 0.13
    if daypart in {"snack", "dinner"}:
        base += 0.05
    if subtotal >= 450:
        base -= 0.04
    elif subtotal <= 220:
        base += 0.04
    return max(0.05, min(0.24, base))


def _choose_upsell(menu_items: list[dict[str, Any]], current_items: list[dict[str, Any]], daypart: str, rng: np.random.Generator) -> dict[str, Any] | None:
    existing_names = {item["name"] for item in current_items}
    candidates = [
        item
        for item in menu_items
        if item["name"] not in existing_names
        and (item["category"] in {"Beverages", "Desserts", "Sides", "Bakery"})
        and item["price"] <= 220
    ]
    if not candidates:
        return None
    chosen = candidates[int(rng.integers(0, len(candidates)))]
    return {"name": chosen["name"], "price": chosen["price"], "quantity": 1, "is_upsell": True}


def _customer_name(order_ref: int) -> str:
    return f"Synthetic Guest {order_ref + 1}"


def _customer_phone(order_ref: int) -> str:
    return f"90000{order_ref % 100000:05d}"
