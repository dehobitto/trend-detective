"""Trend statistics: OLS with t-test and confidence intervals, Mann-Kendall, Sen's slope.

Pure numpy/scipy so it can be unit tested in isolation. Time ``t`` is in years.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np
from scipy import stats

Direction = Literal["rising", "falling", "flat"]

FLAT_FRACTION_OF_STD = 0.05
"""A trend whose total change is below this fraction of the series' std-dev is called "flat"."""


@dataclass(frozen=True)
class OLSResult:
    slope: float            # units per year
    intercept: float        # fitted value at t = 0
    slope_se: float
    slope_ci: tuple[float, float]
    t_stat: float
    p_value: float
    r_squared: float
    residual_std: float
    n: int
    t_mean: float
    sxx: float
    t_crit: float

    def predict(self, t: np.ndarray) -> np.ndarray:
        return self.intercept + self.slope * t

    def mean_ci(self, t: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Confidence band of the fitted mean trend line at times ``t``."""
        se = self.residual_std * np.sqrt(1.0 / self.n + (t - self.t_mean) ** 2 / self.sxx)
        fit = self.predict(t)
        return fit - self.t_crit * se, fit + self.t_crit * se


@dataclass(frozen=True)
class MannKendallResult:
    s: float
    var_s: float
    z: float
    p_value: float
    tau: float


def ols(t: np.ndarray, y: np.ndarray, alpha: float = 0.05) -> OLSResult:
    """Ordinary least squares ``y = a + b t`` with a two-sided t-test on ``b`` (df = n - 2)."""
    t, y = _clean(t, y)
    n = len(t)
    if n < 3:
        raise ValueError("Need at least 3 data points to fit a trend.")
    t_mean, y_mean = t.mean(), y.mean()
    sxx = float(np.sum((t - t_mean) ** 2))
    if sxx == 0:
        raise ValueError("All data points have the same date.")
    slope = float(np.sum((t - t_mean) * (y - y_mean)) / sxx)
    intercept = float(y_mean - slope * t_mean)
    resid = y - (intercept + slope * t)
    ss_res = float(np.sum(resid**2))
    ss_tot = float(np.sum((y - y_mean) ** 2))
    if not (np.isfinite(slope) and np.isfinite(ss_res)):
        raise ValueError("The values are too large to fit a trend line.")
    df = n - 2
    residual_std = float(np.sqrt(ss_res / df))
    slope_se = residual_std / np.sqrt(sxx)
    t_crit = float(stats.t.ppf(1 - alpha / 2, df))
    if slope_se > 0:
        t_stat = slope / slope_se
        p_value = float(2 * stats.t.sf(abs(t_stat), df))
    else:  # perfect fit
        t_stat = float("inf") if slope != 0 else 0.0
        p_value = 0.0 if slope != 0 else 1.0
    return OLSResult(
        slope=slope,
        intercept=intercept,
        slope_se=float(slope_se),
        slope_ci=(slope - t_crit * slope_se, slope + t_crit * slope_se),
        t_stat=float(t_stat),
        p_value=p_value,
        r_squared=1 - ss_res / ss_tot if ss_tot > 0 else 1.0,
        residual_std=residual_std,
        n=n,
        t_mean=float(t_mean),
        sxx=sxx,
        t_crit=t_crit,
    )


def mann_kendall(y: np.ndarray) -> MannKendallResult:
    """Mann-Kendall monotonic trend test with tie correction (normal approximation, continuity-corrected).

    ``y`` must be in time order; NaNs are dropped.
    """
    y = np.asarray(y, dtype=float)
    y = y[~np.isnan(y)]
    n = len(y)
    if n < 3:
        raise ValueError("Need at least 3 data points for the Mann-Kendall test.")
    i, j = np.triu_indices(n, k=1)
    s = float(np.sign(y[j] - y[i]).sum())
    _, tie_counts = np.unique(y, return_counts=True)
    tie_term = float(np.sum(tie_counts * (tie_counts - 1) * (2 * tie_counts + 5)))
    var_s = (n * (n - 1) * (2 * n + 5) - tie_term) / 18.0
    if var_s <= 0:
        z = 0.0
    elif s > 0:
        z = (s - 1) / np.sqrt(var_s)
    elif s < 0:
        z = (s + 1) / np.sqrt(var_s)
    else:
        z = 0.0
    p_value = float(2 * stats.norm.sf(abs(z)))
    tau = s / (n * (n - 1) / 2)
    return MannKendallResult(s=s, var_s=float(var_s), z=float(z), p_value=p_value, tau=float(tau))


def sens_slope(t: np.ndarray, y: np.ndarray) -> float:
    """Theil-Sen estimator: median of all pairwise slopes (units per unit of ``t``)."""
    t, y = _clean(t, y)
    i, j = np.triu_indices(len(t), k=1)
    dt = t[j] - t[i]
    keep = dt != 0
    if not keep.any():
        return 0.0
    return float(np.median((y[j] - y[i])[keep] / dt[keep]))


def sens_slope_ci(
    t: np.ndarray, y: np.ndarray, alpha: float = 0.05,
) -> tuple[float, float, tuple[float, float]]:
    """Sen's slope with a nonparametric confidence interval based on Mann-Kendall variance.

    Returns ``(slope, intercept, (ci_low, ci_high))`` where ``intercept = median(y - slope * t)``.
    """
    t, y = _clean(t, y)
    n = len(t)
    i, j = np.triu_indices(n, k=1)
    dt = t[j] - t[i]
    keep = dt != 0
    slopes = (y[j] - y[i])[keep] / dt[keep]
    slope = float(np.median(slopes))
    intercept = float(np.median(y - slope * t))

    # CI from the Mann-Kendall variance of S
    _, tie_counts = np.unique(y, return_counts=True)
    tie_term = float(np.sum(tie_counts * (tie_counts - 1) * (2 * tie_counts + 5)))
    var_s = (n * (n - 1) * (2 * n + 5) - tie_term) / 18.0
    C = stats.norm.ppf(1 - alpha / 2) * np.sqrt(var_s)
    N = len(slopes)
    srt = np.sort(slopes)
    lo = int(np.clip(np.floor((N - C) / 2) - 1, 0, N - 1))
    hi = int(np.clip(np.ceil((N + C) / 2), 0, N - 1))
    return slope, intercept, (float(srt[lo]), float(srt[hi]))


def lag1_autocorrelation(x: np.ndarray) -> float:
    """Lag-1 autocorrelation of a series (NaNs dropped)."""
    x = np.asarray(x, dtype=float)
    x = x[~np.isnan(x)]
    if len(x) < 3:
        return 0.0
    x = x - x.mean()
    denom = float(np.sum(x**2))
    return float(np.sum(x[:-1] * x[1:]) / denom) if denom > 0 else 0.0


def classify_direction(slope_per_year: float, span_years: float, series_std: float) -> Direction:
    """Rising/falling by the sign of the slope, unless the total change is negligible vs. the noise."""
    total = slope_per_year * span_years
    if slope_per_year == 0 or abs(total) < FLAT_FRACTION_OF_STD * series_std:
        return "flat"
    return "rising" if slope_per_year > 0 else "falling"


def _clean(t: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    t = np.asarray(t, dtype=float)
    y = np.asarray(y, dtype=float)
    if t.shape != y.shape:
        raise ValueError("t and y must have the same length")
    ok = ~(np.isnan(t) | np.isnan(y))
    return t[ok], y[ok]


@dataclass(frozen=True)
class TrendAnalysis:
    """Everything the API needs from the trend step."""

    stats: dict[str, float | int | bool | str | None]
    """Fields of ``schemas.TrendStats``."""
    trend: np.ndarray
    ci_low: np.ndarray
    ci_high: np.ndarray
    residual_lag1: float


def analyze(
    t_years: np.ndarray,
    y: np.ndarray,
    *,
    alpha: float = 0.05,
    reference_mean: float | None = None,
    ratio_scale: bool = True,
) -> TrendAnalysis:
    """Run OLS, Mann-Kendall and Sen's slope on ``y(t)`` and package the results.

    ``t_years`` is a time axis in years (any origin; it is shifted so the intercept is the fitted value
    at the first time step). ``reference_mean`` is the mean of the raw (not deseasonalized) values and is
    used for ``percent_change``; percent change is None when ``ratio_scale`` is False or the mean is ~0.
    """
    t = np.asarray(t_years, dtype=float)
    t = t - t[0]
    y = np.asarray(y, dtype=float)
    mk = mann_kendall(y)
    sen_b, sen_a, sen_ci = sens_slope_ci(t, y, alpha)

    valid = ~np.isnan(y)
    n = int(valid.sum())
    span = float(t[valid][-1] - t[valid][0])
    total_change = sen_b * span
    mean = reference_mean if reference_mean is not None else float(np.nanmean(y))
    percent = None
    if ratio_scale and abs(mean) > 1e-9:
        percent = total_change / abs(mean) * 100
    series_std = float(np.nanstd(y))

    # Trend line and CI band based on Sen's slope.
    # Pivot CI lines through the temporal midpoint so the band always contains the trend.
    trend = sen_a + sen_b * t
    t_mid = (t[valid][0] + t[valid][-1]) / 2
    y_mid = sen_a + sen_b * t_mid
    dt = t - t_mid
    raw_lo = y_mid + sen_ci[0] * dt
    raw_hi = y_mid + sen_ci[1] * dt
    ci_low = np.minimum(raw_lo, raw_hi)
    ci_high = np.maximum(raw_lo, raw_hi)

    resid = y - trend
    # R² of the Sen line (descriptive: share of variance explained by a straight line)
    ss_tot = float(np.nansum((y[valid] - np.nanmean(y)) ** 2))
    ss_res = float(np.nansum(resid[valid] ** 2))
    r_squared = 1 - ss_res / ss_tot if ss_tot > 0 else 1.0

    stats_fields: dict[str, float | int | bool | str | None] = {
        "n": n,
        "slope_per_year": sen_b,
        "slope_per_decade": sen_b * 10,
        "slope_ci_low_per_decade": sen_ci[0] * 10,
        "slope_ci_high_per_decade": sen_ci[1] * 10,
        "intercept": sen_a,
        "r_squared": r_squared,
        "mk_tau": mk.tau,
        "mk_z": mk.z,
        "mk_p_value": mk.p_value,
        "total_change": total_change,
        "percent_change": percent,
        "direction": classify_direction(sen_b, span, series_std),
        "significant": bool(mk.p_value < alpha),
        "alpha": alpha,
    }
    return TrendAnalysis(
        stats=stats_fields,
        trend=trend,
        ci_low=ci_low,
        ci_high=ci_high,
        residual_lag1=lag1_autocorrelation(resid),
    )
