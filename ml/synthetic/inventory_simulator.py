from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timedelta
from typing import Any

import numpy as np


def simulate_inventory(
    start_date: date,
    days: int,
    ingredients: list[dict[str, Any]],
    recipes: dict[str, list[dict[str, Any]]],
    order_items: list[dict[str, Any]],
    rng: np.random.Generator,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[date, dict[str, float]]]:
    ingredient_by_name = {ingredient["name"]: ingredient for ingredient in ingredients}
    on_hand = {ingredient["name"]: _initial_stock(ingredient) for ingredient in ingredients}
    target_stock = {ingredient["name"]: _target_stock(ingredient) for ingredient in ingredients}
    min_stock = {ingredient["name"]: target_stock[ingredient["name"]] * 0.35 for ingredient in ingredients}

    items_by_day: dict[date, list[dict[str, Any]]] = defaultdict(list)
    for item in order_items:
        items_by_day[item["created_at"].date()].append(item)

    snapshots: list[dict[str, Any]] = []
    waste_logs: list[dict[str, Any]] = []
    daily_consumption: dict[date, dict[str, float]] = {}

    for offset in range(days):
        current_day = start_date + timedelta(days=offset)
        consumption = _calculate_consumption(items_by_day[current_day], recipes, rng)
        daily_consumption[current_day] = consumption

        for ingredient_name, quantity in consumption.items():
            on_hand[ingredient_name] = max(0.0, on_hand[ingredient_name] - quantity)

        waste_for_day = _simulate_waste(current_day, ingredients, on_hand, consumption, rng)
        for waste in waste_for_day:
            on_hand[waste["ingredient_name"]] = max(0.0, on_hand[waste["ingredient_name"]] - waste["quantity_wasted"])
            ingredient = ingredient_by_name[waste["ingredient_name"]]
            waste["cost_value"] = round(waste["quantity_wasted"] * ingredient["cost_per_unit"], 2)
            waste_logs.append(waste)

        _restock(ingredients, on_hand, target_stock, min_stock, rng)

        recorded_at = datetime.combine(current_day, time(23, int(rng.integers(0, 45)), int(rng.integers(0, 60))))
        for ingredient in ingredients:
            name = ingredient["name"]
            snapshots.append(
                {
                    "ingredient_name": name,
                    "quantity_on_hand": round(on_hand[name], 2),
                    "recorded_at": recorded_at,
                    "recorded_by": "synthetic-system",
                }
            )

    return snapshots, waste_logs, daily_consumption


def _initial_stock(ingredient: dict[str, Any]) -> float:
    return round(max(float(ingredient["min_order_quantity"]) * 3.5, 2.0), 2)


def _target_stock(ingredient: dict[str, Any]) -> float:
    shelf_life = int(ingredient["shelf_life_hours"])
    multiplier = 2.0 if shelf_life <= 48 else 3.5 if shelf_life <= 120 else 5.5
    return round(max(float(ingredient["min_order_quantity"]) * multiplier, 2.0), 2)


def _calculate_consumption(order_items: list[dict[str, Any]], recipes: dict[str, list[dict[str, Any]]], rng: np.random.Generator) -> dict[str, float]:
    consumption: dict[str, float] = defaultdict(float)
    for item in order_items:
        recipe = recipes.get(item["menu_name"], [])
        quantity_sold = float(item["quantity"])
        portion_variance = float(rng.normal(1.025, 0.035))
        for component in recipe:
            ingredient_name = component["ingredient_name"]
            consumption[ingredient_name] += float(component["quantity_used"]) * quantity_sold * portion_variance
    return {name: round(quantity, 4) for name, quantity in consumption.items()}


def _simulate_waste(
    current_day: date,
    ingredients: list[dict[str, Any]],
    on_hand: dict[str, float],
    consumption: dict[str, float],
    rng: np.random.Generator,
) -> list[dict[str, Any]]:
    waste_logs: list[dict[str, Any]] = []
    power_cut_day = rng.random() < 0.025

    for ingredient in ingredients:
        name = ingredient["name"]
        shelf_life = int(ingredient["shelf_life_hours"])
        storage_type = ingredient["storage_type"]
        stock = on_hand[name]
        consumed = consumption.get(name, 0.0)

        waste_rate = 0.0
        reason = "spoiled"

        if shelf_life <= 36:
            waste_rate += float(rng.uniform(0.010, 0.045))
            reason = "expired"
        elif shelf_life <= 72:
            waste_rate += float(rng.uniform(0.004, 0.020))
            reason = "spoiled"

        if storage_type == "refrigerated" and power_cut_day:
            waste_rate += float(rng.uniform(0.008, 0.030))
            reason = "spoiled"

        if consumed > 0 and rng.random() < 0.10:
            overprep = consumed * float(rng.uniform(0.010, 0.040))
            waste_logs.append(_waste_row(current_day, name, overprep, "overprepped", rng))

        if waste_rate > 0 and stock > 0:
            wasted = min(stock * waste_rate, stock * 0.18)
            if wasted >= 0.01:
                waste_logs.append(_waste_row(current_day, name, wasted, reason, rng))

        if rng.random() < 0.002 and stock > 0.5:
            dropped = min(stock * float(rng.uniform(0.005, 0.018)), stock)
            waste_logs.append(_waste_row(current_day, name, dropped, "dropped", rng))

    return waste_logs


def _waste_row(current_day: date, ingredient_name: str, quantity: float, reason: str, rng: np.random.Generator) -> dict[str, Any]:
    logged_at = datetime.combine(current_day, time(int(rng.integers(10, 22)), int(rng.integers(0, 60)), 0))
    return {
        "ingredient_name": ingredient_name,
        "quantity_wasted": round(max(quantity, 0.01), 2),
        "reason": reason,
        "notes": f"Synthetic {reason.replace('_', ' ')} event",
        "logged_at": logged_at,
        "logged_by": "synthetic-system",
    }


def _restock(
    ingredients: list[dict[str, Any]],
    on_hand: dict[str, float],
    target_stock: dict[str, float],
    min_stock: dict[str, float],
    rng: np.random.Generator,
) -> None:
    for ingredient in ingredients:
        name = ingredient["name"]
        if on_hand[name] <= min_stock[name]:
            order_quantity = max(target_stock[name] - on_hand[name], float(ingredient["min_order_quantity"]))
            on_hand[name] = round(on_hand[name] + order_quantity * float(rng.uniform(0.96, 1.06)), 2)
