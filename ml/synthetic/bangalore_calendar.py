from __future__ import annotations

# Backward-compatible shim for existing training imports.
from synthetic.india_calendar import CalendarEffects, TIME_OF_DAY_WEIGHTS, get_calendar_effects

__all__ = ["CalendarEffects", "TIME_OF_DAY_WEIGHTS", "get_calendar_effects"]
