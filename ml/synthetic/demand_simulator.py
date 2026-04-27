from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Any

import numpy as np

from config import CITIES
from synthetic.customer_profiles import ARCHETYPES, CustomerProfile, generate_customer_pool, seasonal_archetype_multiplier
from synthetic.india_calendar import CalendarEffects, get_calendar_effects
from synthetic.weather_data import WeatherDay, generate_weather_for_day


def simulate_demand(
    start_date: date,
    days: int,
    menu_items: list[dict[str, Any]],
    rng: np.random.Generator,
    city: str = "bangalore",
    customer_pool_size: int = 500,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[date, WeatherDay]]:
    orders: list[dict[str, Any]] = []
    order_items: list[dict[str, Any]] = []
    weather_by_day: dict[date, WeatherDay] = {}
    city_key = city.lower()
    baseline = int(CITIES.get(city_key, CITIES["bangalore"])["baseline_daily_orders"])
    customers = generate_customer_pool(customer_pool_size, rng)
    customers_by_archetype = _group_customers(customers)

    for offset in range(days):
        day = start_date + timedelta(days=offset)
        calendar = get_calendar_effects(day, city_key, rng)
        weather = generate_weather_for_day(day, rng, city_key)
        weather_by_day[day] = weather
        if offset and offset % 30 == 0:
            print(f"  Generated {offset}/{days} days for {city_key.title()}...")

        base_orders = baseline * (1.35 if calendar.is_weekend else 1.0)
        noisy_multiplier = float(rng.normal(1.0, 0.08))
        order_count = max(
            18,
            int(round(base_orders * calendar.daily_multiplier * weather.demand_multiplier * noisy_multiplier)),
        )

        for _ in range(order_count):
            customer = _sample_visiting_customer(customers_by_archetype, day, calendar, weather, rng)
            daypart = _sample_daypart(city_key, customer.archetype, day, weather, rng)
            order_time = _sample_order_time(day, daypart, city_key, weather, rng)
            group_size = _sample_group_size(customer.archetype, daypart, calendar.is_weekend, rng)
            items = _sample_items_for_customer(menu_items, customer, daypart, group_size, weather, calendar, rng)
            subtotal = round(sum(item["price"] * item["quantity"] for item in items) * weather.aov_multiplier, 2)

            pairing_accepted = rng.random() < _upsell_probability(subtotal, daypart, customer, items)
            upsell_value = 0
            if pairing_accepted:
                upsell = _choose_upsell(menu_items, items, daypart, customer, rng)
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
                    "customer_name": customer.name,
                    "customer_phone": customer.phone,
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


def _group_customers(customers: list[CustomerProfile]) -> dict[str, list[CustomerProfile]]:
    grouped: dict[str, list[CustomerProfile]] = {archetype: [] for archetype in ARCHETYPES}
    for customer in customers:
        grouped[customer.archetype].append(customer)
    return grouped


def _sample_visiting_customer(
    customers_by_archetype: dict[str, list[CustomerProfile]],
    day: date,
    calendar: CalendarEffects,
    weather: WeatherDay,
    rng: np.random.Generator,
) -> CustomerProfile:
    archetypes = list(ARCHETYPES)
    weights = []
    for archetype in archetypes:
        profile = ARCHETYPES[archetype]
        weight = float(profile["share"]) * seasonal_archetype_multiplier(archetype, day)
        if archetype == "daily_ritualist":
            weight *= 1.8 if not calendar.is_weekend else 0.03
        elif archetype == "weekend_explorer":
            weight *= 2.0 if calendar.is_weekend else 0.35
        elif archetype == "social_group_diner":
            weight *= 1.4 if calendar.is_weekend or day.weekday() == 4 else 0.7
        elif archetype == "wfc_professional":
            weight *= 1.5 if not calendar.is_weekend else 0.35
        elif archetype == "health_optimizer":
            weight *= 1.2 if day.weekday() in {0, 1, 2, 3, 4, 5} else 0.7
        sensitivity = float(profile["weather_sensitivity"])
        weight *= max(0.12, 1.0 - ((1.0 - weather.demand_multiplier) * sensitivity * 0.65))
        weights.append(weight)

    probabilities = np.array(weights, dtype=float)
    probabilities = probabilities / probabilities.sum()
    archetype = str(rng.choice(archetypes, p=probabilities))
    candidates = [customer for customer in customers_by_archetype[archetype] if day.weekday() in customer.visit_days]
    if not candidates:
        candidates = customers_by_archetype[archetype]
    return candidates[int(rng.integers(0, len(candidates)))]


def _sample_daypart(city: str, archetype: str, day: date, weather: WeatherDay, rng: np.random.Generator) -> str:
    if archetype == "daily_ritualist":
        return "breakfast"
    if archetype == "wfc_professional":
        return "lunch"
    if archetype == "health_optimizer":
        return str(rng.choice(["breakfast", "lunch"], p=[0.58, 0.42]))
    if archetype == "weekend_explorer":
        return str(rng.choice(["brunch", "snack"], p=[0.58, 0.42]))
    if archetype == "social_group_diner":
        if day.weekday() < 5:
            return str(rng.choice(["lunch", "dinner"], p=[0.62, 0.38]))
        return str(rng.choice(["dinner", "lunch"], p=[0.65, 0.35]))

    names = ["breakfast", "lunch", "snack", "dinner"]
    weights = np.array([0.24, 0.28, 0.18, 0.30], dtype=float)
    if city == "mumbai":
        names.append("late_night")
        weights = np.array([0.18, 0.25, 0.17, 0.30, 0.10], dtype=float)
    if city == "delhi" and weather.temperature_c > 38:
        weights = np.array([0.15, 0.20, 0.15, 0.50], dtype=float)
    weights = weights / weights.sum()
    return str(rng.choice(names, p=weights))


def _sample_order_time(day: date, daypart: str, city: str, weather: WeatherDay, rng: np.random.Generator) -> datetime:
    windows = {
        "breakfast": (8, 10),
        "brunch": (10, 13),
        "lunch": (12, 15),
        "snack": (16, 18),
        "dinner": (19, 21),
        "late_night": (21, 23),
    }
    start, end = windows.get(daypart, (12, 15))
    if city == "mumbai":
        start = min(23, start + 1)
        end = min(23, end + 1)
    if city == "delhi" and daypart == "breakfast" and (weather.is_fog_day or weather.temperature_c < 22):
        start, end = 9, 11
    if city == "delhi" and daypart == "dinner" and weather.temperature_c > 38:
        start, end = 19, 22
    hour = int(rng.integers(start, end + 1))
    minute = int(rng.integers(0, 60))
    second = int(rng.integers(0, 60))
    return datetime.combine(day, time(hour, minute, second))


def _sample_group_size(archetype: str, daypart: str, is_weekend: bool, rng: np.random.Generator) -> int:
    if archetype == "daily_ritualist":
        return 1
    if archetype == "wfc_professional":
        return int(rng.choice([1, 2], p=[0.80, 0.20]))
    if archetype == "health_optimizer":
        return int(rng.choice([1, 2], p=[0.60, 0.40]))
    if archetype == "weekend_explorer":
        return int(rng.choice([1, 2, 3, 4], p=[0.10, 0.42, 0.28, 0.20]))
    if archetype == "social_group_diner":
        return int(rng.choice([3, 4, 5, 6], p=[0.32, 0.36, 0.22, 0.10]))
    if daypart == "breakfast":
        return int(rng.choice([1, 2, 3, 4], p=[0.62, 0.28, 0.08, 0.02]))
    return int(rng.choice([1, 2, 3, 4], p=[0.34, 0.38, 0.18, 0.10] if is_weekend else [0.48, 0.34, 0.13, 0.05]))


def _sample_items_for_customer(
    menu_items: list[dict[str, Any]],
    customer: CustomerProfile,
    daypart: str,
    group_size: int,
    weather: WeatherDay,
    calendar: CalendarEffects,
    rng: np.random.Generator,
) -> list[dict[str, Any]]:
    archetype = customer.archetype
    selected: list[dict[str, Any]]

    if archetype == "daily_ritualist":
        drink = _find_item(menu_items, customer.preferred_drink or "Cappuccino") or _weighted_menu_choice(_beverages(menu_items), daypart, weather, archetype, calendar, rng)
        selected = [{"name": drink["name"], "price": drink["price"], "quantity": 1}]
        if rng.random() < 0.28:
            pastry = _choose_named(menu_items, ["Classic Croissant", "Granola Bowl", "French Toast"], rng)
            if pastry:
                selected.append({"name": pastry["name"], "price": pastry["price"], "quantity": 1})
    elif archetype == "weekend_explorer":
        selected = _choose_many(menu_items, daypart, weather, archetype, calendar, rng, max(2, group_size + int(rng.integers(1, 3))))
        if rng.random() < 0.50:
            dessert = _weighted_menu_choice(_category(menu_items, "Desserts"), daypart, weather, archetype, calendar, rng)
            selected.append({"name": dessert["name"], "price": dessert["price"], "quantity": 1})
    elif archetype == "wfc_professional":
        selected = []
        for names in (["Americano", "Cold Brew", "Cappuccino"], ["French Fries", "Garlic Bread", "Pesto Veg Sandwich"], ["Caesar Salad", "Club Sandwich", "Pesto Pasta", "Buddha Bowl"]):
            item = _choose_named(menu_items, names, rng)
            if item:
                selected.append({"name": item["name"], "price": item["price"], "quantity": 1})
        if rng.random() < 0.35:
            drink = _weighted_menu_choice(_beverages(menu_items), daypart, weather, archetype, calendar, rng)
            selected.append({"name": drink["name"], "price": drink["price"], "quantity": 1})
    elif archetype == "social_group_diner":
        selected = _choose_many(menu_items, daypart, weather, archetype, calendar, rng, group_size + 1)
        starter = _weighted_menu_choice(_categories(menu_items, {"Sides", "Starters"}), daypart, weather, archetype, calendar, rng)
        selected.append({"name": starter["name"], "price": starter["price"], "quantity": max(1, group_size // 3)})
        if rng.random() < 0.60:
            dessert = _weighted_menu_choice(_category(menu_items, "Desserts"), daypart, weather, archetype, calendar, rng)
            selected.append({"name": dessert["name"], "price": dessert["price"], "quantity": 1 if rng.random() < 0.75 else 2})
    elif archetype == "health_optimizer":
        selected = _choose_many(menu_items, daypart, weather, archetype, calendar, rng, max(1, group_size))
        if rng.random() < 0.55:
            drink = _choose_named(menu_items, ["Green Tea", "Americano", "Cold Brew", "Berry Smoothie", "Mango Smoothie"], rng) or _weighted_menu_choice(_beverages(menu_items), daypart, weather, archetype, calendar, rng)
            selected.append({"name": drink["name"], "price": drink["price"], "quantity": 1})
    else:
        selected = _choose_many(menu_items, daypart, weather, archetype, calendar, rng, max(1, group_size))

    compact: dict[str, dict[str, Any]] = {}
    for item in selected:
        if item["name"] not in compact:
            compact[item["name"]] = item.copy()
        else:
            compact[item["name"]]["quantity"] += 1
    return list(compact.values())


def _choose_many(
    menu_items: list[dict[str, Any]],
    daypart: str,
    weather: WeatherDay,
    archetype: str,
    calendar: CalendarEffects,
    rng: np.random.Generator,
    count: int,
) -> list[dict[str, Any]]:
    selected = []
    for _ in range(count):
        item = _weighted_menu_choice(menu_items, daypart, weather, archetype, calendar, rng)
        selected.append({"name": item["name"], "price": item["price"], "quantity": 1})
    return selected


def _weighted_menu_choice(
    menu_items: list[dict[str, Any]],
    daypart: str,
    weather: WeatherDay,
    archetype: str,
    calendar: CalendarEffects,
    rng: np.random.Generator,
) -> dict[str, Any]:
    if not menu_items:
        raise ValueError("Cannot sample from an empty menu item list.")
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
        tags = set(item.get("tags", []))
        name = item["name"].lower()
        if "comfort" in tags or any(token in name for token in ["maggi", "soup", "chai", "pav", "rajma", "parantha"]):
            weight *= weather.comfort_food_multiplier
        if "soup" in name:
            weight *= weather.soup_multiplier
        if "ice cream" in name:
            weight *= weather.ice_cream_multiplier
        if archetype == "weekend_explorer" and ("visual" in tags or "premium" in tags or item["name"] in {"Avocado Sourdough Toast", "Avocado Toast", "Eggs Benedict", "Pancake Stack", "Berry Smoothie"}):
            weight *= 1.75
        if archetype == "health_optimizer":
            weight *= 2.4 if "healthy" in tags or item["name"] in {"Buddha Bowl", "Quinoa Buddha Bowl", "Greek Veg Salad", "Granola Bowl", "Avocado Sourdough Toast"} else 0.25
            if item["category"] == "Desserts" or "fried" in tags:
                weight *= 0.10
        if archetype == "social_group_diner" and ("shareable" in tags or item["category"] in {"Mains", "Sides", "Burgers", "Sandwiches"}):
            weight *= 1.45
        weight *= calendar.premium_multiplier if "premium" in tags else 1.0
        weight *= calendar.health_multiplier if "healthy" in tags else 1.0
        if item["price"] > 300:
            weight *= 0.84
        elif item["price"] < 150:
            weight *= 1.08
        weights.append(weight)

    weights_array = np.array(weights, dtype=float)
    weights_array = weights_array / weights_array.sum()
    idx = int(rng.choice(len(menu_items), p=weights_array))
    return menu_items[idx]


def _upsell_probability(subtotal: float, daypart: str, customer: CustomerProfile, items: list[dict[str, Any]]) -> float:
    profile = ARCHETYPES[customer.archetype]
    base = float(profile["upsell_probability"])
    if daypart in {"snack", "dinner"}:
        base += 0.05
    if subtotal >= 450:
        base -= 0.04
    elif subtotal <= 220:
        base += 0.04
    if customer.archetype == "health_optimizer" and any("smoothie" in item["name"].lower() or "bowl" in item["name"].lower() for item in items):
        base = max(base, float(profile.get("health_upsell_probability", base)))
    return max(0.05, min(0.55, base))


def _choose_upsell(
    menu_items: list[dict[str, Any]],
    current_items: list[dict[str, Any]],
    daypart: str,
    customer: CustomerProfile,
    rng: np.random.Generator,
) -> dict[str, Any] | None:
    existing_names = {item["name"] for item in current_items}
    allowed_categories = {"Beverages", "Desserts", "Sides", "Bakery", "Breakfast"}
    candidates = [
        item
        for item in menu_items
        if item["name"] not in existing_names
        and (item["category"] in allowed_categories)
        and item["price"] <= 220
    ]
    if customer.archetype == "health_optimizer":
        health_candidates = [item for item in candidates if "healthy" in item.get("tags", []) or item["name"] in {"Berry Smoothie", "Mango Smoothie", "Granola Bowl", "Americano", "Cold Brew"}]
        candidates = health_candidates or candidates
    if customer.archetype == "daily_ritualist":
        candidates = [item for item in candidates if item["category"] in {"Bakery", "Beverages"}]
    if not candidates:
        return None
    chosen = candidates[int(rng.integers(0, len(candidates)))]
    return {"name": chosen["name"], "price": chosen["price"], "quantity": 1, "is_upsell": True}


def _find_item(menu_items: list[dict[str, Any]], name: str) -> dict[str, Any] | None:
    return next((item for item in menu_items if item["name"] == name), None)


def _choose_named(menu_items: list[dict[str, Any]], names: list[str], rng: np.random.Generator) -> dict[str, Any] | None:
    candidates = [item for item in menu_items if item["name"] in names]
    if not candidates:
        return None
    return candidates[int(rng.integers(0, len(candidates)))]


def _beverages(menu_items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return _category(menu_items, "Beverages")


def _category(menu_items: list[dict[str, Any]], category: str) -> list[dict[str, Any]]:
    return [item for item in menu_items if item["category"] == category]


def _categories(menu_items: list[dict[str, Any]], categories: set[str]) -> list[dict[str, Any]]:
    rows = [item for item in menu_items if item["category"] in categories]
    return rows or [item for item in menu_items if item["category"] == "Sides"]
