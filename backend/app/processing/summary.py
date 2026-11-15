"""Plain-English verdicts for students."""

from __future__ import annotations

import math

from app.schemas.analysis import TrendStats

UNITLESS = {"", "1", "unitless", "none", "-"}


def format_number(x: float, sig: int = 2) -> str:
    """Round to ``sig`` significant figures without scientific notation for typical magnitudes."""
    if x == 0 or not math.isfinite(x):
        return "0" if x == 0 else str(x)
    digits = sig - int(math.floor(math.log10(abs(x)))) - 1
    rounded = round(x, digits)
    if digits <= 0:
        return f"{int(rounded):,}"
    return f"{rounded:.{digits}f}"


def format_p(p: float) -> str:
    return "p < 0.001" if p < 0.001 else f"p = {p:.3f}" if p < 0.01 else f"p = {p:.2f}"


def with_units(value: str, units: str) -> str:
    if units.strip().lower() in UNITLESS:
        return value
    sep = "" if units in {"%", "°"} else " "
    return f"{value}{sep}{units}"


def build_summary(stats: TrendStats, units: str, start_year: int, end_year: int) -> str:
    """One or two sentences: direction + rate, then whether the Mann-Kendall test finds it significant."""
    rate = with_units(format_number(abs(stats.slope_per_decade)), units)
    period = f"{start_year}–{end_year}"

    if stats.direction == "flat" and not stats.significant:
        head = f"No clear change from {period} (the trend line moves by less than the normal ups and downs)."
    else:
        verb = "Rising" if stats.slope_per_decade > 0 else "Falling"
        total = with_units(format_number(abs(stats.total_change)), units)
        head = f"{verb} by {rate} per decade ({'+' if stats.total_change > 0 else '−'}{total} over {period})."

    if stats.significant:
        tail = f"The Mann-Kendall test confirms this trend is significant ({format_p(stats.mk_p_value)})."
    else:
        tail = (
            f"This is not statistically significant ({format_p(stats.mk_p_value)}): "
            "it could just be natural year-to-year variability."
        )
    return f"{head} {tail}"
