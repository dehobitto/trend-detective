"""Cleaning steps between fetching and trend testing: trimming, gap filling, deseasonalizing."""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

MAX_FILL_GAP = 2
"""Interior gaps of up to this many consecutive periods are linearly interpolated."""


@dataclass
class Preprocessed:
    raw: pd.Series
    """Aggregated values (after gap filling)."""
    deseasonalized: pd.Series | None
    """Anomalies from the monthly climatology, or None when not requested / not applicable."""
    seasonal: pd.Series | None = None
    """Seasonal component on ``raw``'s dates (``raw`` = level + trend + seasonal + residual), or None
    exactly when ``deseasonalized`` is None."""
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


MONTHS = 12
MIN_YEARS_PER_MONTH = 3
"""Each calendar month needs this many detrended values to estimate its seasonal offset."""


def _centered_annual_mean(series: pd.Series) -> pd.Series:
    """Centered 2x12 moving average (weights 1/24, 1/12 x 11, 1/24): the series with the seasonal cycle
    averaged out, a rough trend. Every calendar month gets the same weight, so the cycle cancels exactly.

    NaN wherever the 13-month window is not complete (the first and last 6 months, around gaps): a
    lopsided window would let part of the seasonal cycle leak into the trend.
    """
    weights = np.r_[0.5, np.ones(MONTHS - 1), 0.5] / MONTHS
    return series.rolling(MONTHS + 1, center=True).apply(lambda w: float(np.dot(w, weights)), raw=True)


def _is_regular_monthly(index: pd.Index) -> bool:
    if not isinstance(index, pd.DatetimeIndex) or len(index) < 2:
        return False
    return bool(index.equals(pd.date_range(index[0], periods=len(index), freq="MS")))


def seasonal_cycle(series: pd.Series) -> pd.Series:
    """Typical offset of each calendar month from the trend (index 1..12, sums to 0).

    Classical decomposition: remove a rough trend first (centered 2x12 moving average), then average the
    detrended values per calendar month. Averaging the raw values instead would let the trend leak into the
    cycle (in a rising record December reads high just because it comes later in the year).
    Records too short for that (fewer than ``MIN_YEARS_PER_MONTH`` detrended values for some month) fall
    back to the raw monthly means. A series without all 12 calendar months has no monthly cycle: all zeros.
    """
    months = pd.Index(range(1, MONTHS + 1), name="month")
    if series.index.month.nunique() < MONTHS:
        return pd.Series(0.0, index=months)
    detrended = series - _centered_annual_mean(series) if _is_regular_monthly(series.index) else None
    if detrended is None or detrended.groupby(detrended.index.month).count().min() < MIN_YEARS_PER_MONTH:
        detrended = series
    cycle = detrended.groupby(detrended.index.month).mean().reindex(months)
    return (cycle - cycle.mean()).astype(float)


def monthly_climatology(series: pd.Series) -> pd.Series:
    """Expected value for each calendar month (index 1..12): the series mean plus the seasonal cycle."""
    return seasonal_cycle(series) + series.mean()


def seasonal_component(series: pd.Series) -> pd.Series:
    """The seasonal cycle laid out on the series' own dates (sums to ~0 over each year)."""
    cycle = seasonal_cycle(series)
    return pd.Series(cycle.reindex(series.index.month).to_numpy(), index=series.index, name=series.name)


def deseasonalize(series: pd.Series) -> pd.Series:
    """Subtract the monthly climatology, leaving monthly anomalies (centered on 0)."""
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

    anomalies = seasonal = None
    if want_deseasonalized:
        if is_monthly:
            anomalies = deseasonalize(filled)
            seasonal = seasonal_component(filled)
        else:
            warnings.append("Deseasonalizing only applies to monthly data, so the annual values were analyzed directly.")

    was_filled = series.isna() & filled.notna()
    return Preprocessed(raw=filled, deseasonalized=anomalies, seasonal=seasonal, warnings=warnings, filled=was_filled)
