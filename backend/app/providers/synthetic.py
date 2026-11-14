"""Deterministic synthetic data so the whole app works without NASA credentials.

Gridded variables
-----------------
For a request we lay a small grid over the bbox and build, per grid point,

    value = base(lat) + local_base + amp(lat) * cos(2π (month - peak) / 12)
            + background_trend + hotspot_trend + red_noise

then take the cos-latitude weighted area mean. The background trend is a smooth function of the bbox
center (so nearby boxes give similar answers and distant regions can give opposite ones); "hotspots"
from the catalog add local mean offsets, extra seasonality and local trends that may change at a
``break_year`` (e.g. NO₂ over Beijing rising until ~2011, then falling). ``dips`` temporarily remove part
of the hotspot (human-made) excess, e.g. the 2020 COVID lockdowns for NO₂.

"Series" variables (coverage ``series``)
----------------------------------------
A single global / station record (Mauna Loa CO₂, NOAA marine CH₄): the bbox is ignored and the curve is
the catalog ``curve`` knots (linear between them) plus the seasonal cycle and red noise.

Real products may be daily (GLDAS, OMI); like every provider we return the **monthly area mean**.

Noise is AR(1) and seeded from a hash of (variable, bbox), and is generated over the whole availability
window before slicing, so the same request always gives the same numbers and changing the dates just
shows a different window.
"""

from __future__ import annotations

import datetime as dt
import hashlib
from functools import lru_cache

import numpy as np
import pandas as pd

from app.catalog.models import CatalogVariable, Hotspot, SyntheticHints
from app.config import Settings
from app.processing.timeseries import area_mean, decimal_years
from app.providers.base import ProviderError, register_provider
from app.schemas.common import BBox

MAX_GRID = 5
TREND_ORIGIN_YEAR = 2000.0


def stable_seed(*parts: object) -> int:
    """Process-independent seed (Python's ``hash`` is salted per process)."""
    digest = hashlib.sha256("|".join(map(str, parts)).encode()).digest()
    return int.from_bytes(digest[:8], "little")


def _hotspot_weight(lat, lon, h: Hotspot):
    """Gaussian weight of hotspot ``h`` at (lat, lon); scalars or numpy arrays."""
    dlat = lat - h.lat
    dlon = (lon - h.lon) * np.cos(np.deg2rad((lat + h.lat) / 2))
    return np.exp(-(dlat**2 + dlon**2) / h.radius**2)


def _background_factor(hints: SyntheticHints, variable_id: str, lat, lon):
    rng = np.random.default_rng(stable_seed("phase", variable_id))
    p1, p2 = rng.uniform(0, 2 * np.pi, size=2)
    wave = np.sin(np.deg2rad(lat) * 3 + p1) * np.cos(np.deg2rad(lon) * 2 + p2)
    damp = np.minimum(1.0, sum((h.damp * _hotspot_weight(lat, lon, h) for h in hints.hotspots), 0.0))
    return (hints.bias + hints.spread * wave) * (1 - damp)


def _polar(hints: SyntheticHints, lat):
    return 1 + hints.polar_amplification * np.maximum(0.0, np.abs(lat) - 55) / 35


def trend_per_year(hints: SyntheticHints, variable_id: str, lat: float, lon: float) -> float:
    """Region-dependent linear trend (units/year) at a location (hotspots: their trend after any break)."""
    factor = _background_factor(hints, variable_id, lat, lon)
    factor += sum(h.trend * _hotspot_weight(lat, lon, h) for h in hints.hotspots)
    return float(hints.trend_per_decade * factor * _polar(hints, lat) / 10)


def _background_trend(hints: SyntheticHints, variable_id: str, lat, lon, t: np.ndarray) -> np.ndarray:
    """Smooth large-scale trend signal (catalog units) over decimal years ``t``."""
    scale = hints.trend_per_decade * _polar(hints, lat) / 10
    return scale * _background_factor(hints, variable_id, lat, lon) * (t - TREND_ORIGIN_YEAR)


def _hotspot_terms(hints: SyntheticHints, weights: list, lat, t: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Local (hotspot) excess over the background and extra seasonal half-range.

    Each hotspot adds ``w * (base + trend signal)``; its trend is piecewise linear when it has a break year.
    Its extra seasonal amplitude scales with how much of its excess is left (a cleaned-up city also has
    a smaller winter peak), so values do not swing below zero once a hotspot has faded.
    ``lat`` and the weights are scalars or arrays of point positions; ``t`` broadcasts against them.
    """
    scale = hints.trend_per_decade * _polar(hints, lat) / 10
    shape = np.broadcast_shapes(np.shape(t), np.shape(lat))
    excess = np.zeros(shape)
    extra_amp = np.zeros(shape)
    for h, w in zip(hints.hotspots, weights):
        if np.all(w < 1e-6):
            continue
        if h.break_year is None:
            signal = scale * h.trend * (t - TREND_ORIGIN_YEAR)
        else:
            b = h.break_year
            signal = scale * (h.trend_before * (np.minimum(t, b) - b) + h.trend * (np.maximum(t, b) - b))
        excess += w * (h.base + signal)
        if h.amp:
            ratio = np.clip((h.base + signal) / h.base, 0, None) if h.base > 0 else 1.0
            extra_amp += w * h.amp * ratio
    return excess, extra_amp


def _dip_factor(hints: SyntheticHints, index: pd.DatetimeIndex) -> np.ndarray:
    """1 normally; ``1 - fraction`` in months covered by a dip (applied to hotspot excess only)."""
    factor = np.ones(len(index))
    for d in hints.dips:
        inside = (index >= pd.Timestamp(d.start).replace(day=1)) & (index <= pd.Timestamp(d.end))
        factor[inside] *= 1 - d.fraction
    return factor


def _ar1(rng: np.random.Generator, n: int, phi: float, sd: float) -> np.ndarray:
    """AR(1) noise with stationary standard deviation ``sd``."""
    innovations = rng.normal(0, sd * np.sqrt(1 - phi**2), size=n)
    out = np.empty(n)
    out[0] = rng.normal(0, sd)
    for i in range(1, n):
        out[i] = phi * out[i - 1] + innovations[i]
    return out


def _grid(bbox: BBox) -> tuple[np.ndarray, np.ndarray]:
    def axis(lo: float, hi: float) -> np.ndarray:
        k = int(np.clip(np.ceil((hi - lo) / 2), 1, MAX_GRID))
        edges = np.linspace(lo, hi, k + 1)
        return (edges[:-1] + edges[1:]) / 2

    return axis(bbox.south, bbox.north), axis(bbox.west, bbox.east)


def _seasonal(amp, peak_month: int, lat, months: np.ndarray) -> np.ndarray:
    peak = np.where(np.asarray(lat) >= 0, peak_month, (peak_month + 6 - 1) % 12 + 1)
    return amp * np.cos(2 * np.pi * (months - peak) / 12)


def _hints(variable: CatalogVariable) -> SyntheticHints:
    if variable.synthetic is None:
        raise ProviderError(f"No synthetic data is configured for {variable.name}.")
    return variable.synthetic


def _index(variable: CatalogVariable) -> pd.DatetimeIndex:
    return pd.date_range(variable.available_start, variable.available_end, freq="MS")


def _apply_gaps(values: np.ndarray, hints: SyntheticHints, rng: np.random.Generator) -> np.ndarray:
    if hints.gap_fraction > 0:
        values[rng.random(len(values)) < hints.gap_fraction] = np.nan
    return values


def _signal(
    hints: SyntheticHints, variable_id: str, lat, lon, index: pd.DatetimeIndex, background=None
) -> tuple[np.ndarray, np.ndarray]:
    """Noise-free ``(level, seasonal)`` at points ``(lat, lon)`` for each month of ``index``.

    ``level = base(lat) + background trend + dip * hotspot excess`` and ``seasonal`` is the seasonal
    cycle (base + hotspot amplitude); both have shape ``(len(index), *point_shape)``. ``background``
    overrides the per-point background trend (an area series uses the one at the bbox center).
    This is the single place the synthetic formula lives: area series and map grids both use it.
    """
    lat, lon = np.asarray(lat, dtype=float), np.asarray(lon, dtype=float)
    time_shape = (len(index),) + (1,) * lat.ndim
    t = decimal_years(index).reshape(time_shape)
    months = index.month.to_numpy().reshape(time_shape)
    dip = _dip_factor(hints, index).reshape(time_shape)
    weights = [_hotspot_weight(lat, lon, h) for h in hints.hotspots]
    excess, extra_amp = _hotspot_terms(hints, weights, lat, t)
    if background is None:
        background = _background_trend(hints, variable_id, lat, lon, t)
    level = hints.base + hints.base_lat * np.abs(lat) + background + dip * excess
    amp = np.maximum(0.0, hints.amp + hints.amp_lat * np.abs(lat) + dip * extra_amp)
    return level, _seasonal(amp, hints.peak_month, lat, months)


def _noise_sd(hints: SyntheticHints, lat, level):
    """Noise grows with |lat| (noise_lat) and with the local level (noise_rel), following it over time."""
    return hints.noise + hints.noise_lat * np.abs(lat) + hints.noise_rel * np.abs(level)


def generate_series(variable: CatalogVariable) -> pd.Series:
    """Full-availability monthly curve for a "series" variable (no bbox: one global/station record)."""
    hints = _hints(variable)
    index = _index(variable)
    t = decimal_years(index)
    knots = np.array(hints.curve or [(t[0], hints.base)], dtype=float)
    rng = np.random.default_rng(stable_seed(variable.id, "series"))
    lat = variable.location.lat if variable.location else 0.0
    values = (
        np.interp(t, knots[:, 0], knots[:, 1])
        + _seasonal(hints.amp, hints.peak_month, lat, index.month.to_numpy())
        + _ar1(rng, len(index), hints.ar1, hints.noise)
    )
    values = _apply_gaps(np.clip(values, hints.min, hints.max), hints, rng)
    return pd.Series(values, index=index, name=variable.id)


def generate(variable: CatalogVariable, bbox: BBox | None) -> pd.Series:
    """Full-availability monthly area-mean series for (variable, bbox)."""
    if variable.is_series:
        return generate_series(variable)
    if bbox is None:
        raise ProviderError("Select an area (bbox) on the map first.")
    hints = _hints(variable)
    index = _index(variable)
    n = len(index)

    rng = np.random.default_rng(
        stable_seed(variable.id, round(bbox.west, 4), round(bbox.south, 4), round(bbox.east, 4), round(bbox.north, 4))
    )
    lats, lons = _grid(bbox)
    c_lat, c_lon = bbox.center
    # The background trend is shared across the bbox (taken at its center); noise follows the center level.
    center_level, _ = _signal(hints, variable.id, c_lat, c_lon, index)
    background = _background_trend(hints, variable.id, c_lat, c_lon, decimal_years(index))
    noise_sd = _noise_sd(hints, c_lat, center_level)
    shared_noise = _ar1(rng, n, hints.ar1, 1.0) * noise_sd

    lat2, lon2 = np.meshgrid(lats, lons, indexing="ij")
    level, seasonal = _signal(hints, variable.id, lat2, lon2, index, background=background[:, None, None])
    local_noise = rng.normal(0, 1.0, size=(len(lats), len(lons), n)).transpose(2, 0, 1) * noise_sd[:, None, None] * 0.3
    cube = np.clip(level + seasonal + shared_noise[:, None, None] + local_noise, hints.min, hints.max)

    values = _apply_gaps(area_mean(cube, lats), hints, rng)
    return pd.Series(values, index=index, name=variable.id)


# ---------------------------------------------------------------- map grids --------------------------------

GRID_NOISE_WAVES = 6


@lru_cache(maxsize=64)
def _grid_noise_waves(variable_id: str, ar1: float, start: str, end: str) -> tuple[np.ndarray, np.ndarray]:
    """Smooth space-time noise for map frames: random plane waves whose amplitudes are AR(1) in time.

    Returns (wave parameters (K, 3): kx, ky [rad/degree], phase; amplitudes (n_months, K)). Depends only
    on the variable (not on the requested bbox), so panning/zooming never changes the numbers.
    """
    rng = np.random.default_rng(stable_seed(variable_id, "grid-noise"))
    n = len(pd.date_range(start, end, freq="MS"))
    wavelength = rng.uniform(8, 60, size=GRID_NOISE_WAVES)  # degrees
    direction = rng.uniform(0, np.pi, size=GRID_NOISE_WAVES)
    k = 2 * np.pi / wavelength
    params = np.column_stack([k * np.cos(direction), k * np.sin(direction), rng.uniform(0, 2 * np.pi, GRID_NOISE_WAVES)])
    amps = np.column_stack([_ar1(rng, n, ar1, 1.0) for _ in range(GRID_NOISE_WAVES)])
    return params, amps


def grid_values(variable: CatalogVariable, month: pd.Timestamp, lats: np.ndarray, lons: np.ndarray) -> np.ndarray:
    """Synthetic map frame: ``(len(lats), len(lons))`` values for one month (no land mask applied).

    Same model as :func:`generate` (base, seasonality, hotspots, dips, trends via :func:`_signal`), but the
    background trend is evaluated at every cell (the area series takes it at the bbox center) and the
    red noise is a smooth field of plane waves instead of one number per bbox. The cos-lat mean of a frame
    over a bbox therefore tracks that bbox's series up to noise.
    """
    if variable.is_series:
        raise ProviderError(f"{variable.name} is a single record and has no map.")
    hints = _hints(variable)
    full = _index(variable)
    month = pd.Timestamp(month).replace(day=1)
    pos = full.get_indexer([month])[0]
    if pos < 0:
        raise ProviderError(f"{variable.name} has no data for {month:%Y-%m}.")
    lat2, lon2 = np.meshgrid(lats, lons, indexing="ij")
    level, seasonal = _signal(hints, variable.id, lat2, lon2, full[pos:pos + 1])
    params, amps = _grid_noise_waves(
        variable.id, hints.ar1, variable.available_start.isoformat(), variable.available_end.isoformat()
    )
    phase = lon2[..., None] * params[:, 0] + lat2[..., None] * params[:, 1] + params[:, 2]
    noise = (np.cos(phase) * amps[pos]).sum(axis=-1) * np.sqrt(2 / GRID_NOISE_WAVES)
    value = level[0] + seasonal[0] + noise * _noise_sd(hints, lat2, level[0])
    return np.clip(value, hints.min, hints.max)


class SyntheticProvider:
    """Deterministic demo data. Results are flagged ``synthetic: true``."""

    name = "synthetic"
    synthetic = True
    local = True

    def fetch(self, variable: CatalogVariable, bbox: BBox | None, start: dt.date, end: dt.date) -> pd.Series:
        series = generate(variable, None if variable.is_series else bbox)
        return series.loc[pd.Timestamp(start).replace(day=1):pd.Timestamp(end)]


@register_provider("synthetic")
def _factory(settings: Settings) -> SyntheticProvider:
    return SyntheticProvider()
