from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

import numpy as np


COMMON_HOLIDAYS = {
    "2025-08-15": "Independence Day",
    "2025-10-02": "Gandhi Jayanti",
    "2025-10-20": "Deepavali",
    "2025-12-25": "Christmas",
    "2026-01-01": "New Year",
    "2026-01-26": "Republic Day",
    "2026-03-14": "Holi",
}

CITY_HOLIDAYS = {
    "bangalore": {
        "2025-08-27": "Ganesh Chaturthi",
        "2025-11-01": "Karnataka Rajyotsava",
        "2026-01-14": "Makara Sankranti",
        "2026-03-20": "Ugadi",
    },
    "mumbai": {
        "2025-04-18": "Good Friday",
        "2025-08-27": "Ganesh Chaturthi",
        "2025-09-06": "Ganesh Visarjan",
        "2025-09-22": "Navratri Begins",
        "2025-10-02": "Dussehra",
    },
    "delhi": {
        "2025-10-02": "Dussehra",
        "2025-10-10": "Karva Chauth",
        "2025-10-27": "Chhath Puja",
    },
    "chennai": {
        "2026-01-14": "Pongal",
        "2026-01-15": "Pongal",
        "2026-01-16": "Pongal",
        "2026-01-17": "Pongal",
        "2026-04-14": "Tamil New Year",
    },
}

COLLEGE_EXAM_WINDOWS = [
    (date(2025, 11, 10), date(2025, 11, 25)),
    (date(2026, 3, 5), date(2026, 3, 20)),
]

COLLEGE_BREAK_WINDOWS = [
    (date(2025, 12, 20), date(2026, 1, 3)),
]

IT_QUARTER_END_DATES = {
    date(2025, 12, 30),
    date(2025, 12, 31),
    date(2026, 3, 30),
    date(2026, 3, 31),
}


@dataclass(frozen=True)
class CalendarEffects:
    date: date
    city: str
    is_weekend: bool
    is_public_holiday: bool
    holiday_name: str | None
    is_payday_window: bool
    college_multiplier: float
    it_multiplier: float
    daily_multiplier: float
    event_name: str | None = None
    evening_multiplier: float = 1.0
    late_night_multiplier: float = 1.0
    premium_multiplier: float = 1.0
    health_multiplier: float = 1.0
    notes: list[str] | None = None


def get_calendar_effects(day: date, city: str = "bangalore", rng: np.random.Generator | None = None) -> CalendarEffects:
    city_key = city.lower()
    weekday = day.weekday()
    is_weekend = weekday >= 5
    holiday_name = _holiday_name(day, city_key)
    is_public_holiday = holiday_name is not None
    is_payday_window = day.day in {1, 2, 3, 28, 29, 30, 31}

    college_multiplier = 1.0
    if _in_window(day, COLLEGE_EXAM_WINDOWS):
        college_multiplier = 1.12
    if _in_window(day, COLLEGE_BREAK_WINDOWS):
        college_multiplier = 0.86

    it_multiplier = 1.08 if day in IT_QUARTER_END_DATES else 1.0

    day_of_week_multiplier = {
        0: 0.92,
        1: 0.95,
        2: 1.0,
        3: 1.04,
        4: 1.12,
        5: 1.36,
        6: 1.28,
    }[weekday]

    holiday_multiplier = 1.12 if is_public_holiday else 1.0
    event = _city_event_effects(day, city_key, rng)
    payday_multiplier = 1.08 if is_payday_window else 1.0
    daily_multiplier = round(
        day_of_week_multiplier
        * holiday_multiplier
        * payday_multiplier
        * college_multiplier
        * it_multiplier
        * event["daily_multiplier"],
        4,
    )

    return CalendarEffects(
        date=day,
        city=city_key,
        is_weekend=is_weekend,
        is_public_holiday=is_public_holiday,
        holiday_name=holiday_name,
        is_payday_window=is_payday_window,
        college_multiplier=college_multiplier,
        it_multiplier=it_multiplier,
        daily_multiplier=daily_multiplier,
        event_name=event["event_name"],
        evening_multiplier=event["evening_multiplier"],
        late_night_multiplier=event["late_night_multiplier"],
        premium_multiplier=event["premium_multiplier"],
        health_multiplier=event["health_multiplier"],
        notes=event["notes"],
    )


def _holiday_name(day: date, city: str) -> str | None:
    return CITY_HOLIDAYS.get(city, {}).get(day.isoformat()) or COMMON_HOLIDAYS.get(day.isoformat())


def _city_event_effects(day: date, city: str, rng: np.random.Generator | None) -> dict[str, object]:
    result: dict[str, object] = {
        "daily_multiplier": 1.0,
        "evening_multiplier": 1.0,
        "late_night_multiplier": 1.0,
        "premium_multiplier": 1.0,
        "health_multiplier": 1.0,
        "event_name": None,
        "notes": [],
    }

    if city == "bangalore":
        if day == date(2026, 3, 20):
            result.update({"daily_multiplier": 0.75, "event_name": "Ugadi"})
        elif day == date(2025, 11, 1):
            result.update({"daily_multiplier": 1.08, "event_name": "Karnataka Rajyotsava"})
    elif city == "mumbai":
        ganesh_start = date(2025, 8, 27)
        if ganesh_start <= day <= ganesh_start + timedelta(days=10):
            is_major_day = day in {ganesh_start, ganesh_start + timedelta(days=10)}
            route_blocked = bool(rng and rng.random() < 0.55)
            result.update(
                {
                    "daily_multiplier": 0.60 if route_blocked and is_major_day else 1.10 if not route_blocked else 0.82,
                    "event_name": "Ganesh Chaturthi",
                }
            )
        navratri_start = date(2025, 9, 22)
        if navratri_start <= day <= navratri_start + timedelta(days=8):
            result.update({"event_name": "Navratri/Dandiya", "evening_multiplier": 0.70, "late_night_multiplier": 1.20})
        if day == date(2025, 4, 18):
            result.update({"daily_multiplier": 0.95, "event_name": "Good Friday"})
    elif city == "delhi":
        if date(2025, 11, 1) <= day <= date(2026, 2, 28):
            result.update({"daily_multiplier": 1.12, "premium_multiplier": 1.20, "event_name": result["event_name"] or "Winter wedding season"})
        if date(2026, 1, 20) <= day <= date(2026, 1, 26):
            result.update({"daily_multiplier": 1.20, "event_name": "Republic Day parade week"})
        if day.month == 11:
            result.update({"daily_multiplier": float(result["daily_multiplier"]) * 0.92, "event_name": result["event_name"] or "Smog season"})
        if day == date(2025, 10, 10):
            result.update({"evening_multiplier": 1.25, "event_name": "Karva Chauth"})
        if day == date(2025, 10, 2):
            result.update({"daily_multiplier": 0.80, "event_name": "Dussehra"})
        if day == date(2025, 10, 27):
            result.update({"daily_multiplier": 0.85, "event_name": "Chhath Puja"})
    elif city == "chennai":
        if day in {date(2026, 1, 14), date(2026, 1, 15), date(2026, 1, 16), date(2026, 1, 17)}:
            result.update({"daily_multiplier": 0.65, "event_name": "Pongal"})
        if day == date(2026, 4, 14):
            result.update({"daily_multiplier": 0.80, "event_name": "Tamil New Year"})
        if day.month in {10, 11, 12}:
            result["notes"] = ["Northeast monsoon season"]

    return result


def _in_window(day: date, windows: list[tuple[date, date]]) -> bool:
    return any(start <= day <= end for start, end in windows)


TIME_OF_DAY_WEIGHTS = {
    "breakfast": {"start": 8, "end": 11, "weight": 0.24},
    "lunch": {"start": 12, "end": 15, "weight": 0.28},
    "snack": {"start": 16, "end": 18, "weight": 0.18},
    "dinner": {"start": 19, "end": 22, "weight": 0.30},
}
