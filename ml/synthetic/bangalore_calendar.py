from __future__ import annotations

from dataclasses import dataclass
from datetime import date


PUBLIC_HOLIDAYS = {
    "2025-10-02": "Gandhi Jayanti",
    "2025-10-20": "Deepavali",
    "2025-11-01": "Karnataka Rajyotsava",
    "2025-12-25": "Christmas",
    "2026-01-01": "New Year",
    "2026-01-14": "Makara Sankranti",
    "2026-01-26": "Republic Day",
    "2026-03-20": "Ugadi",
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
    is_weekend: bool
    is_public_holiday: bool
    holiday_name: str | None
    is_payday_window: bool
    college_multiplier: float
    it_multiplier: float
    daily_multiplier: float


def _in_window(day: date, windows: list[tuple[date, date]]) -> bool:
    return any(start <= day <= end for start, end in windows)


def get_calendar_effects(day: date) -> CalendarEffects:
    weekday = day.weekday()
    is_weekend = weekday >= 5
    holiday_name = PUBLIC_HOLIDAYS.get(day.isoformat())
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

    holiday_multiplier = 1.22 if is_public_holiday else 1.0
    payday_multiplier = 1.08 if is_payday_window else 1.0
    daily_multiplier = round(
        day_of_week_multiplier * holiday_multiplier * payday_multiplier * college_multiplier * it_multiplier,
        4,
    )

    return CalendarEffects(
        date=day,
        is_weekend=is_weekend,
        is_public_holiday=is_public_holiday,
        holiday_name=holiday_name,
        is_payday_window=is_payday_window,
        college_multiplier=college_multiplier,
        it_multiplier=it_multiplier,
        daily_multiplier=daily_multiplier,
    )


TIME_OF_DAY_WEIGHTS = {
    "breakfast": {"start": 8, "end": 11, "weight": 0.24},
    "lunch": {"start": 12, "end": 15, "weight": 0.28},
    "snack": {"start": 16, "end": 18, "weight": 0.18},
    "dinner": {"start": 19, "end": 22, "weight": 0.30},
}
