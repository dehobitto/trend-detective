"""Cleaning steps between fetching and trend testing: trimming, gap filling, deseasonalizing."""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field

import pandas as pd

MAX_FILL_GAP = 2
"""Interior gaps of up to this many consecutive periods are linearly interpolated."""


@dataclass
class Preprocessed:
    raw: pd.Series
    """Aggregated values (after gap filling)."""
    deseasonalized: pd.Series | None
    """Anomalies from the monthly climatology, or None when not requested / not applicable."""
    warnings: list[str] = field(default_factory=list)
    filled: pd.Series | None = None
    """True where ``raw`` holds an interpolated (not observed) value."""

    @property
    def analyzed(self) -> pd.Series:
        return self.deseasonalized if self.deseasonalized is not None else self.raw

    @property
    def tested(self) -> pd.Series:
        """``analyzed`` with interpolated values blanked out.

        Interpolated points add no information; counting them would inflate n and the autocorrelation
        and make the p-values too small, so the trend tests only see observed values.
        """
        return self.analyzed if self.filled is None else self.analyzed.where(~self.filled)


def trim(series: pd.Series, start: dt.date, end: dt.date) -> pd.Series:
    """Keep values with ``start <= date <= end`` (period start dates)."""
    return series.loc[pd.Timestamp(start):pd.Timestamp(end)]


def fill_gaps(series: pd.Series, max_gap: int = MAX_FILL_GAP) -> tuple[pd.Series, int]:
    """Linearly interpolate short interior gaps. Returns (filled series, number of values filled).

    Longer gaps and leading/trailing gaps stay NaN; the trend tests simply skip them.
    """
    if series.isna().sum() == 0:
        return series, 0
    is_na = series.isna()
    run_id = (~is_na).cumsum()
    run_len = is_na.groupby(run_id).transform("sum")
    interpolated = series.interpolate(method="linear", limit_area="inside")
    fillable = is_na & (run_len <= max_gap) & interpolated.notna()
    filled = series.where(~fillable, interpolated)
    return filled, int(fillable.sum())


def monthly_climatology(series: pd.Series) -> pd.Series:
    """Mean value for each calendar month (index 1..12)."""
    return series.groupby(series.index.month).mean()


def deseasonalize(series: pd.Series) -> pd.Series:
    """Subtract the mean seasonal cycle, leaving monthly anomalies."""
    clim = monthly_climatology(series)
    return series - clim.reindex(series.index.month).to_numpy()


def preprocess(series: pd.Series, *, want_deseasonalized: bool, is_monthly: bool) -> Preprocessed:
    """Gap-fill and optionally deseasonalize an already aggregated series."""
    warnings: list[str] = []
    filled, n_filled = fill_gaps(series)
    if n_filled:
        warnings.append(
            f"{n_filled} missing value(s) were filled by interpolating between neighbors for the chart; "
            "the trend tests use only the measured values."
        )
    remaining = int(filled.isna().sum())
    if remaining:
        warnings.append(f"{remaining} period(s) have no data and were skipped.")

    anomalies = None
    if want_deseasonalized:
        if is_monthly:
            anomalies = deseasonalize(filled)
        else:
            warnings.append("Deseasonalizing only applies to monthly data, so the annual values were analyzed directly.")
    was_filled = series.isna() & filled.notna()
    return Preprocessed(raw=filled, deseasonalized=anomalies, warnings=warnings, filled=was_filled)
