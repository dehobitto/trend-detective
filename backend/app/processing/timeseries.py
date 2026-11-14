"""Time-series plumbing: spatial area mean, resampling, time axes.

All series in the pipeline are ``pd.Series`` of floats indexed by a ``DatetimeIndex`` at period start
(month start for monthly data, Jan 1 for annual data). Missing values are NaN.
"""

from __future__ import annotations

from typing import Literal

import numpy as np
import pandas as pd

Frequency = Literal["daily", "monthly", "annual"]

DAYS_PER_YEAR = 365.2425


def area_mean(values: np.ndarray, lats: np.ndarray) -> np.ndarray:
    """Cosine-latitude weighted spatial mean of a ``(time, lat, lon)`` cube, ignoring NaNs.

    Grid cells shrink toward the poles, so each row is weighted by ``cos(lat)``.
    Returns a 1-D array of length ``time`` (NaN where a whole time slice is missing).
    """
    if values.ndim != 3 or values.shape[1] != len(lats):
        raise ValueError("values must be (time, lat, lon) with len(lats) rows")
    weights = np.cos(np.deg2rad(lats))[None, :, None] * np.ones_like(values)
    weights = np.where(np.isnan(values), 0.0, weights)
    total = weights.sum(axis=(1, 2))
    summed = np.nansum(values * weights, axis=(1, 2))
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(total > 0, summed / total, np.nan)


def to_monthly(series: pd.Series) -> pd.Series:
    """Average any finer-grained series into calendar months (index = month start)."""
    return series.resample("MS").mean().astype(float)


def to_annual(series: pd.Series, min_months: int = 9) -> pd.Series:
    """Average a monthly series into calendar years; years with < ``min_months`` valid months are NaN."""
    grouped = series.resample("YS")
    means = grouped.mean()
    counts = grouped.count()
    return means.where(counts >= min_months).astype(float)


def decimal_years(index: pd.DatetimeIndex) -> np.ndarray:
    """Time axis in fractional years (e.g. 2000-07-02 -> ~2000.5)."""
    year_start = pd.to_datetime(index.year.astype(str) + "-01-01")
    return index.year.to_numpy() + ((index - year_start).days.to_numpy() / DAYS_PER_YEAR)


def infer_frequency(index: pd.DatetimeIndex) -> Frequency:
    """Guess the native spacing of an (uploaded) series from its median time step."""
    if len(index) < 2:
        return "monthly"
    median_days = float(np.median(np.diff(index.values).astype("timedelta64[D]").astype(float)))
    if median_days >= 300:
        return "annual"
    if median_days >= 25:
        return "monthly"
    return "daily"


def span_years(index: pd.DatetimeIndex) -> float:
    """Length of the record in years, counting the last period as a full step."""
    if len(index) == 0:
        return 0.0
    step_days = {"daily": 1.0, "monthly": DAYS_PER_YEAR / 12, "annual": DAYS_PER_YEAR}[infer_frequency(index)]
    return ((index[-1] - index[0]).days + step_days) / DAYS_PER_YEAR
