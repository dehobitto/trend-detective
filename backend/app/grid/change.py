"""Change maps (docs/API.md, "v3 additions"): anomaly frames and per-cell trend grids.

Everything here works on a *cube* ``(months, rows, cols)`` of synthetic map values built in one vectorized
pass from the same model as :func:`app.providers.synthetic.grid_values` (so a cube slice equals the
single-month frame exactly).

Trend statistics per cell
-------------------------
* **Slope**: ordinary least squares on the *deseasonalized* monthly series (each calendar month's mean over
  the requested period is subtracted), in closed form across the time axis for all cells at once, reported
  per decade.
* **Significance**: Mann-Kendall on the **annual means** of the deseasonalized series (years with fewer than
  6 valid months are dropped), two-sided normal approximation with ``var(S) = n(n-1)(2n+5)/18``. Using
  annual means keeps the pairwise sign sum cheap (n ≈ 25 years -> 300 pairs instead of ~45 000 for monthly
  data) and removes most of the month-to-month autocorrelation that would otherwise inflate significance.
  This differs from the area analysis (``/api/analyses``), which runs MK on the monthly series.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
from scipy.special import erfc

from app.catalog.models import CatalogVariable
from app.processing.timeseries import decimal_years
from app.providers.synthetic import (
    GRID_NOISE_WAVES,
    _grid_noise_waves,
    _hints,
    _hotspot_weight,
    _index,
    _noise_sd,
    _signal,
)

DIVERGING_COLORS = ["#07668A", "#6FA3BA", "#F2F4F5", "#C9A06A", "#9A5200"]
"""Falling (deep blue) -> neutral at 0 -> rising (ochre), the app-wide falling/rising identity."""
DIVERGING_POSITIONS = [-1.0, -0.5, 0.0, 0.5, 1.0]
MIN_YEARS = 3
MIN_MONTHS_PER_YEAR = 6


def diverging_colormap(r: float) -> dict:
    return {"name": "diverging", "stops": [[round(p * r, 6), c] for p, c in zip(DIVERGING_POSITIONS, DIVERGING_COLORS)]}


def value_cube(
    variable: CatalogVariable,
    index: pd.DatetimeIndex,
    lats: np.ndarray,
    lons: np.ndarray,
    mask: np.ndarray | None = None,
) -> np.ndarray:
    """Synthetic values ``(len(index), len(lats), len(lons))``, equal to ``grid_values`` month by month.

    Only cells in ``mask`` (default: all) are computed, the rest are NaN. Cells farther than ~4 radii from
    every hotspot (weight < 1e-6) are computed without the hotspot terms, which is the expensive part of
    the model and contributes nothing there.
    """
    hints = _hints(variable)
    full = _index(variable)
    pos = full.get_indexer(index)
    if (pos < 0).any():
        raise ValueError("months outside the variable's availability")
    lat2, lon2 = np.meshgrid(lats, lons, indexing="ij")
    out = np.full((len(index),) + lat2.shape, np.nan)
    sel = np.ones(lat2.shape, bool) if mask is None else mask
    plat, plon = lat2[sel], lon2[sel]
    if plat.size == 0:
        return out
    near = np.zeros(plat.shape, bool)
    for h in hints.hotspots:
        near |= _hotspot_weight(plat, plon, h) >= 1e-6
    level = np.empty((len(index), plat.size))
    seasonal = np.empty_like(level)
    bare = hints.model_copy(update={"hotspots": []})
    for part, h in ((near, hints), (~near, bare)):
        if part.any():
            lv, se = _signal(h, variable.id, plat[part], plon[part], index)
            level[:, part], seasonal[:, part] = lv, se
    params, amps = _grid_noise_waves(
        variable.id, hints.ar1, variable.available_start.isoformat(), variable.available_end.isoformat()
    )
    phase = plon[:, None] * params[:, 0] + plat[:, None] * params[:, 1] + params[:, 2]
    noise = (amps[pos] @ np.cos(phase).T) * np.sqrt(2 / GRID_NOISE_WAVES)
    value = level + seasonal + noise * _noise_sd(hints, plat, level)
    out[:, sel] = np.clip(value, hints.min, hints.max)
    return out


def monthly_climatology(cube: np.ndarray, months: np.ndarray) -> np.ndarray:
    """``(12, rows, cols)`` mean of each calendar month (index 0 = January); NaN-aware."""
    out = np.full((12,) + cube.shape[1:], np.nan)
    with np.errstate(invalid="ignore", divide="ignore"):
        for m in range(1, 13):
            sel = cube[months == m]
            if len(sel):
                ok = np.isfinite(sel)
                out[m - 1] = np.where(ok, sel, 0.0).sum(axis=0) / ok.sum(axis=0)
    return out


def deseasonalize(cube: np.ndarray, months: np.ndarray) -> np.ndarray:
    clim = monthly_climatology(cube, months)
    return cube - clim[months - 1]


def ols_slope(t: np.ndarray, cube: np.ndarray) -> np.ndarray:
    """Closed-form OLS slope along axis 0 (units per unit of ``t``) for every cell; NaN cells -> NaN."""
    tc = t - t.mean()
    y = cube - cube.mean(axis=0)
    return np.tensordot(tc, y, axes=(0, 0)) / np.sum(tc**2)


def annual_means(anom: np.ndarray, years: np.ndarray) -> np.ndarray:
    """``(n_years, rows, cols)`` means; years with fewer than MIN_MONTHS_PER_YEAR months are dropped."""
    uniq = np.unique(years)
    keep = [y for y in uniq if (years == y).sum() >= MIN_MONTHS_PER_YEAR]
    return np.stack([anom[years == y].mean(axis=0) for y in keep])


def mann_kendall_p(series: np.ndarray) -> np.ndarray:
    """Two-sided Mann-Kendall p-value along axis 0 for every cell (no tie correction; NaN cells -> NaN).

    S = sum over pairs i<j of sign(x_j - x_i), vectorized over cells; var(S) = n(n-1)(2n+5)/18 and the
    usual continuity correction.
    """
    n = series.shape[0]
    s = np.zeros(series.shape[1:])
    for i in range(n - 1):
        s += np.sign(series[i + 1:] - series[i]).sum(axis=0)
    var = n * (n - 1) * (2 * n + 5) / 18
    z = np.where(s > 0, (s - 1) / math.sqrt(var), np.where(s < 0, (s + 1) / math.sqrt(var), 0.0))
    p = erfc(np.abs(z) / math.sqrt(2))
    return np.where(np.isfinite(series).all(axis=0), p, np.nan)


def trend_fields(cube: np.ndarray, index: pd.DatetimeIndex) -> tuple[np.ndarray, np.ndarray]:
    """(slope per decade, MK p-value on annual means) per cell for a monthly cube over ``index``."""
    months = index.month.to_numpy()
    anom = deseasonalize(cube, months)
    slope = ols_slope(decimal_years(index), anom) * 10
    annual = annual_means(anom, index.year.to_numpy())
    return slope, mann_kendall_p(annual)
