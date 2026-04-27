from __future__ import annotations

from dataclasses import dataclass
from datetime import date

import numpy as np


CITY_MONTH_WEATHER = {
    "bangalore": {
        1: {"temp_range": (27, 29), "rain_prob": 0.05, "humidity": 0.56},
        2: {"temp_range": (29, 31), "rain_prob": 0.05, "humidity": 0.50},
        3: {"temp_range": (32, 34), "rain_prob": 0.10, "humidity": 0.48},
        4: {"temp_range": (33, 35), "rain_prob": 0.15, "humidity": 0.54},
        5: {"temp_range": (32, 34), "rain_prob": 0.20, "humidity": 0.62},
        6: {"temp_range": (28, 30), "rain_prob": 0.60, "humidity": 0.74},
        7: {"temp_range": (26, 28), "rain_prob": 0.70, "humidity": 0.78},
        8: {"temp_range": (26, 28), "rain_prob": 0.65, "humidity": 0.78},
        9: {"temp_range": (27, 29), "rain_prob": 0.55, "humidity": 0.75},
        10: {"temp_range": (27, 29), "rain_prob": 0.40, "humidity": 0.72},
        11: {"temp_range": (26, 28), "rain_prob": 0.20, "humidity": 0.66},
        12: {"temp_range": (25, 27), "rain_prob": 0.05, "humidity": 0.60},
    },
    "mumbai": {
        1: {"temp_range": (30, 32), "rain_prob": 0.00, "humidity": 0.60},
        2: {"temp_range": (30, 32), "rain_prob": 0.00, "humidity": 0.58},
        3: {"temp_range": (31, 33), "rain_prob": 0.00, "humidity": 0.62},
        4: {"temp_range": (32, 34), "rain_prob": 0.00, "humidity": 0.68},
        5: {"temp_range": (33, 35), "rain_prob": 0.02, "humidity": 0.72},
        6: {"temp_range": (30, 32), "rain_prob": 0.75, "humidity": 0.85},
        7: {"temp_range": (28, 30), "rain_prob": 0.90, "humidity": 0.90},
        8: {"temp_range": (28, 30), "rain_prob": 0.85, "humidity": 0.88},
        9: {"temp_range": (29, 31), "rain_prob": 0.70, "humidity": 0.82},
        10: {"temp_range": (31, 33), "rain_prob": 0.25, "humidity": 0.72},
        11: {"temp_range": (32, 34), "rain_prob": 0.05, "humidity": 0.62},
        12: {"temp_range": (30, 32), "rain_prob": 0.00, "humidity": 0.58},
    },
    "delhi": {
        1: {"temp_range": (19, 21), "rain_prob": 0.05, "humidity": 0.70},
        2: {"temp_range": (22, 24), "rain_prob": 0.08, "humidity": 0.62},
        3: {"temp_range": (28, 31), "rain_prob": 0.05, "humidity": 0.48},
        4: {"temp_range": (35, 38), "rain_prob": 0.03, "humidity": 0.34},
        5: {"temp_range": (40, 43), "rain_prob": 0.05, "humidity": 0.30},
        6: {"temp_range": (39, 42), "rain_prob": 0.20, "humidity": 0.42},
        7: {"temp_range": (34, 36), "rain_prob": 0.50, "humidity": 0.68},
        8: {"temp_range": (33, 35), "rain_prob": 0.50, "humidity": 0.72},
        9: {"temp_range": (33, 35), "rain_prob": 0.30, "humidity": 0.62},
        10: {"temp_range": (32, 34), "rain_prob": 0.05, "humidity": 0.50},
        11: {"temp_range": (27, 29), "rain_prob": 0.00, "humidity": 0.52},
        12: {"temp_range": (20, 22), "rain_prob": 0.03, "humidity": 0.68},
    },
}


@dataclass(frozen=True)
class WeatherDay:
    date: date
    city: str
    temperature_c: float
    rain_mm: float
    humidity: float
    condition: str
    demand_multiplier: float
    cold_beverage_multiplier: float
    hot_beverage_multiplier: float
    delivery_multiplier: float
    aov_multiplier: float
    comfort_food_multiplier: float
    soup_multiplier: float
    ice_cream_multiplier: float
    is_flood_shutdown: bool = False
    is_fog_day: bool = False
    is_dust_storm: bool = False


def generate_weather_for_day(day: date, rng: np.random.Generator, city: str = "bangalore") -> WeatherDay:
    city_key = city.lower()
    if city_key not in CITY_MONTH_WEATHER:
        raise ValueError(f"Unsupported city: {city}")

    month_profile = CITY_MONTH_WEATHER[city_key][day.month]
    low, high = month_profile["temp_range"]
    temperature = float(rng.normal((low + high) / 2.0, 0.8))
    temperature = max(low - 1.2, min(high + 1.2, temperature))
    is_rainy = rng.random() < month_profile["rain_prob"]
    rain_mm = _rainfall_mm(city_key, day.month, is_rainy, rng)
    humidity = min(0.95, max(0.35, float(rng.normal(month_profile["humidity"], 0.06))))
    is_flood_shutdown = city_key == "mumbai" and day.month in {7, 8} and rain_mm >= 85 and rng.random() < 0.25
    is_fog_day = city_key == "delhi" and day.month in {12, 1} and rng.random() < 0.30
    is_dust_storm = city_key == "delhi" and day.month == 5 and rng.random() < 0.10

    if is_flood_shutdown:
        condition = "flood_shutdown"
    elif is_dust_storm:
        condition = "dust_storm"
    elif is_fog_day:
        condition = "fog"
    elif rain_mm >= 25:
        condition = "heavy_rain"
    elif rain_mm >= 5:
        condition = "rain"
    elif temperature >= 38:
        condition = "extreme_heat"
    elif temperature >= 33:
        condition = "hot"
    elif temperature <= 22:
        condition = "cool"
    else:
        condition = "pleasant"

    multipliers = _weather_multipliers(
        city_key,
        temperature,
        rain_mm,
        humidity,
        is_flood_shutdown,
        is_fog_day,
        is_dust_storm,
    )

    return WeatherDay(
        date=day,
        city=city_key,
        temperature_c=round(temperature, 1),
        rain_mm=round(rain_mm, 1),
        humidity=round(humidity, 2),
        condition=condition,
        demand_multiplier=round(multipliers["demand"], 4),
        cold_beverage_multiplier=round(multipliers["cold"], 4),
        hot_beverage_multiplier=round(multipliers["hot"], 4),
        delivery_multiplier=round(multipliers["delivery"], 4),
        aov_multiplier=round(multipliers["aov"], 4),
        comfort_food_multiplier=round(multipliers["comfort"], 4),
        soup_multiplier=round(multipliers["soup"], 4),
        ice_cream_multiplier=round(multipliers["ice_cream"], 4),
        is_flood_shutdown=is_flood_shutdown,
        is_fog_day=is_fog_day,
        is_dust_storm=is_dust_storm,
    )


def _rainfall_mm(city: str, month: int, is_rainy: bool, rng: np.random.Generator) -> float:
    if not is_rainy:
        return 0.0
    if city == "mumbai" and month in {7, 8}:
        return float(rng.gamma(4.2, 18.0))
    if city == "mumbai" and month in {6, 9}:
        return float(rng.gamma(3.2, 12.0))
    if city == "delhi" and month in {7, 8}:
        return float(rng.gamma(2.2, 7.0))
    return float(rng.gamma(2.0, 4.0))


def _weather_multipliers(
    city: str,
    temperature: float,
    rain_mm: float,
    humidity: float,
    is_flood_shutdown: bool,
    is_fog_day: bool,
    is_dust_storm: bool,
) -> dict[str, float]:
    multipliers = {
        "demand": 1.0,
        "cold": 1.0,
        "hot": 1.0,
        "delivery": 1.0,
        "aov": 1.0,
        "comfort": 1.0,
        "soup": 1.0,
        "ice_cream": 1.0,
    }

    if city == "bangalore":
        if rain_mm > 0:
            multipliers.update({"demand": 0.75, "hot": 1.30, "cold": 0.85, "aov": 1.15, "delivery": 1.25})
        if temperature > 32:
            multipliers["cold"] *= 1.35
            multipliers["hot"] *= 0.80
        if temperature < 27:
            multipliers["hot"] *= 1.25
            multipliers["cold"] *= 0.85
    elif city == "mumbai":
        if is_flood_shutdown:
            multipliers.update({"demand": 0.15, "hot": 1.65, "comfort": 1.80, "cold": 0.30, "aov": 1.30, "delivery": 1.80})
        elif rain_mm >= 25:
            multipliers.update({"demand": 0.55, "hot": 1.50, "comfort": 1.60, "cold": 0.40, "aov": 1.25, "delivery": 1.60})
        elif rain_mm > 0:
            multipliers.update({"demand": 0.80, "hot": 1.20, "delivery": 1.25})
        if humidity > 0.85:
            multipliers["cold"] *= 1.20
        if temperature > 33:
            multipliers["cold"] *= 1.40
            multipliers["demand"] *= 0.85
    elif city == "delhi":
        if temperature > 38:
            multipliers.update({"demand": 0.60, "cold": 1.60, "ice_cream": 2.0, "hot": 0.30, "delivery": 1.25})
        if temperature < 22:
            multipliers.update({"hot": 1.50, "soup": 2.0, "cold": 0.40, "demand": multipliers["demand"] * 0.90})
        if is_fog_day:
            multipliers["demand"] *= 0.82
            multipliers["hot"] *= 1.10
        if is_dust_storm:
            multipliers["demand"] *= 0.40
            multipliers["delivery"] *= 1.50
        if rain_mm > 0:
            multipliers["delivery"] *= 1.20

    return multipliers
