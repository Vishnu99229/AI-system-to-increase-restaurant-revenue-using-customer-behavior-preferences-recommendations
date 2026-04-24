from __future__ import annotations

from dataclasses import dataclass
from datetime import date

import numpy as np


MONTH_WEATHER = {
    1: {"mean_temp": 23.5, "rain_prob": 0.03, "humidity": 0.56},
    2: {"mean_temp": 25.0, "rain_prob": 0.04, "humidity": 0.50},
    3: {"mean_temp": 27.5, "rain_prob": 0.10, "humidity": 0.48},
    4: {"mean_temp": 28.5, "rain_prob": 0.18, "humidity": 0.54},
    5: {"mean_temp": 27.8, "rain_prob": 0.35, "humidity": 0.62},
    6: {"mean_temp": 25.5, "rain_prob": 0.55, "humidity": 0.74},
    7: {"mean_temp": 24.5, "rain_prob": 0.60, "humidity": 0.78},
    8: {"mean_temp": 24.3, "rain_prob": 0.58, "humidity": 0.78},
    9: {"mean_temp": 24.5, "rain_prob": 0.50, "humidity": 0.75},
    10: {"mean_temp": 24.2, "rain_prob": 0.40, "humidity": 0.72},
    11: {"mean_temp": 23.0, "rain_prob": 0.20, "humidity": 0.66},
    12: {"mean_temp": 22.0, "rain_prob": 0.08, "humidity": 0.60},
}


@dataclass(frozen=True)
class WeatherDay:
    date: date
    temperature_c: float
    rain_mm: float
    humidity: float
    condition: str
    demand_multiplier: float
    cold_beverage_multiplier: float
    hot_beverage_multiplier: float
    delivery_multiplier: float


def generate_weather_for_day(day: date, rng: np.random.Generator) -> WeatherDay:
    month_profile = MONTH_WEATHER[day.month]
    temperature = float(rng.normal(month_profile["mean_temp"], 1.7))
    is_rainy = rng.random() < month_profile["rain_prob"]
    rain_mm = float(rng.gamma(2.0, 4.0)) if is_rainy else 0.0
    humidity = min(0.95, max(0.35, float(rng.normal(month_profile["humidity"], 0.06))))

    if rain_mm >= 25:
        condition = "heavy_rain"
    elif rain_mm >= 5:
        condition = "rain"
    elif temperature >= 29:
        condition = "hot"
    elif temperature <= 21:
        condition = "cool"
    else:
        condition = "pleasant"

    demand_multiplier = 1.0
    cold_beverage_multiplier = 1.0
    hot_beverage_multiplier = 1.0
    delivery_multiplier = 1.0

    if condition == "heavy_rain":
        demand_multiplier = 0.78
        hot_beverage_multiplier = 1.28
        delivery_multiplier = 1.35
    elif condition == "rain":
        demand_multiplier = 0.92
        hot_beverage_multiplier = 1.14
        delivery_multiplier = 1.18
    elif condition == "hot":
        cold_beverage_multiplier = 1.34
        hot_beverage_multiplier = 0.88
    elif condition == "cool":
        hot_beverage_multiplier = 1.16
        cold_beverage_multiplier = 0.90

    return WeatherDay(
        date=day,
        temperature_c=round(temperature, 1),
        rain_mm=round(rain_mm, 1),
        humidity=round(humidity, 2),
        condition=condition,
        demand_multiplier=round(demand_multiplier, 4),
        cold_beverage_multiplier=round(cold_beverage_multiplier, 4),
        hot_beverage_multiplier=round(hot_beverage_multiplier, 4),
        delivery_multiplier=round(delivery_multiplier, 4),
    )
