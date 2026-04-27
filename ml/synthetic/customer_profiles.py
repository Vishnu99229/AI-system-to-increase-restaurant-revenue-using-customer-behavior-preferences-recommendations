from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any

import numpy as np


INDIAN_NAMES = [
    "Raj", "Priya", "Arun", "Sneha", "Vikram", "Ananya", "Karthik", "Meera",
    "Rohit", "Pooja", "Arjun", "Divya", "Sanjay", "Nisha", "Amit", "Kavya",
    "Rahul", "Deepa", "Suresh", "Lakshmi", "Mohammed", "Fatima", "Ravi", "Swati",
    "Nikhil", "Ishita", "Varun", "Tanvi", "Harsh", "Simran", "Kunal", "Aditi",
    "Siddharth", "Neha", "Manish", "Ritika", "Gaurav", "Shruti", "Aditya", "Pallavi",
]


@dataclass(frozen=True)
class CustomerProfile:
    id: int
    name: str
    phone: str
    archetype: str
    preferred_drink: str | None = None
    visit_days: tuple[int, ...] = ()


ARCHETYPES: dict[str, dict[str, Any]] = {
    "daily_ritualist": {
        "label": "The Daily Ritualist",
        "share": 0.30,
        "upsell_probability": 0.15,
        "weather_sensitivity": 0.35,
        "preferred_dayparts": ("breakfast",),
    },
    "weekend_explorer": {
        "label": "The Weekend Explorer",
        "share": 0.25,
        "upsell_probability": 0.40,
        "weather_sensitivity": 1.25,
        "preferred_dayparts": ("brunch", "snack"),
    },
    "wfc_professional": {
        "label": "The Work-from-Cafe Professional",
        "share": 0.20,
        "upsell_probability": 0.25,
        "weather_sensitivity": 0.45,
        "preferred_dayparts": ("lunch",),
    },
    "social_group_diner": {
        "label": "The Social Group Diner",
        "share": 0.15,
        "upsell_probability": 0.35,
        "weather_sensitivity": 0.80,
        "preferred_dayparts": ("lunch", "dinner"),
    },
    "health_optimizer": {
        "label": "The Health-Conscious Optimizer",
        "share": 0.10,
        "upsell_probability": 0.20,
        "health_upsell_probability": 0.50,
        "weather_sensitivity": 0.65,
        "preferred_dayparts": ("breakfast", "lunch"),
    },
}


def generate_customer_pool(size: int, rng: np.random.Generator) -> list[CustomerProfile]:
    archetype_names = list(ARCHETYPES)
    shares = np.array([ARCHETYPES[name]["share"] for name in archetype_names], dtype=float)
    shares = shares / shares.sum()
    phones: set[str] = set()
    customers: list[CustomerProfile] = []

    for idx in range(size):
        archetype = str(rng.choice(archetype_names, p=shares))
        name = f"{str(rng.choice(INDIAN_NAMES))} {str(rng.choice(INDIAN_NAMES))}"
        phone = _unique_phone(phones, rng)
        preferred_drink = None
        if archetype == "daily_ritualist":
            preferred_drink = str(rng.choice(["Cappuccino", "Filter Coffee", "Masala Chai", "Latte", "Filter Kaapi"]))
        visit_days = _visit_days(archetype, rng)
        customers.append(CustomerProfile(idx, name, phone, archetype, preferred_drink, visit_days))

    return customers


def seasonal_archetype_multiplier(archetype: str, day: date) -> float:
    if archetype == "health_optimizer" and day.month in {1, 3, 4}:
        return 1.25
    if archetype == "social_group_diner" and day.month in {11, 12, 1, 2}:
        return 1.12
    return 1.0


def _visit_days(archetype: str, rng: np.random.Generator) -> tuple[int, ...]:
    if archetype == "daily_ritualist":
        return tuple(sorted(int(day) for day in rng.choice([0, 1, 2, 3, 4], size=int(rng.integers(4, 6)), replace=False)))
    if archetype in {"wfc_professional", "health_optimizer"}:
        return tuple(sorted(int(day) for day in rng.choice([0, 1, 2, 3, 4, 5], size=int(rng.integers(2, 4)), replace=False)))
    if archetype == "weekend_explorer":
        return tuple(sorted(int(day) for day in rng.choice([5, 6], size=int(rng.integers(1, 3)), replace=False)))
    return tuple(sorted(int(day) for day in rng.choice(range(7), size=int(rng.integers(1, 3)), replace=False)))


def _unique_phone(existing: set[str], rng: np.random.Generator) -> str:
    while True:
        phone = f"{int(rng.choice([6, 7, 8, 9]))}{int(rng.integers(0, 10**9)):09d}"
        if phone not in existing:
            existing.add(phone)
            return phone
