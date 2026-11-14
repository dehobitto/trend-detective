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


def _hotspot_weight(lat: float, lon: float, h: Hotspot) -> float:
    dlat = lat - h.lat
    dlon = (lon - h.lon) * np.cos(np.deg2rad((lat + h.lat) / 2))
    return float(np.exp(-(dlat**2 + dlon**2) / h.radius**2))


def _background_factor(hints: SyntheticHints, variable_id: str, lat: float, lon: float) -> float:
    rng = np.random.default_rng(stable_seed("phase", variable_id))
    p1, p2 = rng.uniform(0, 2 * np.pi, size=2)
    wave = np.sin(np.deg2rad(lat) * 3 + p1) * np.cos(np.deg2rad(lon) * 2 + p2)
    damp = min(1.0, sum(h.damp * _hotspot_weight(lat, lon, h) for h in hints.hotspots))
    return float((hints.bias + hints.spread * wave) * (1 - damp))


def _polar(hints: SyntheticHints, lat: float) -> float:
    return 1 + hints.polar_amplification * max(0.0, abs(lat) - 55) / 35


def trend_per_year(hints: SyntheticHints, variable_id: str, lat: float, lon: float) -> float:
    """Region-dependent linear trend (units/year) at a location (hotspots: their trend after any break)."""
    factor = _background_factor(hints, variable_id, lat, lon)
    factor += sum(h.trend * _hotspot_weight(lat, lon, h) for h in hints.hotspots)
    return float(hints.trend_per_decade * factor * _polar(hints, lat) / 10)


def _background_trend(hints: SyntheticHints, variable_id: str, lat: float, lon: float, t: np.ndarray) -> np.ndarray:
    """Smooth large-scale trend signal (catalog units) over decimal years ``t``; shared across a bbox."""
    scale = hints.trend_per_decade * _polar(hints, lat) / 10
    return scale * _background_factor(hints, variable_id, lat, lon) * (t - TREND_ORIGIN_YEAR)


def _hotspot_terms(
    hints: SyntheticHints, weights: list[float], lat: float, t: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """Local (hotspot) excess over the background and extra seasonal half-range at one grid point.

    Each hotspot adds ``w * (base + trend signal)``; its trend is piecewise linear when it has a break year.
    Its extra seasonal amplitude scales with how much of its excess is left (a cleaned-up city also has
    a smaller winter peak), so values do not swing below zero once a hotspot has faded.
    """
    scale = hints.trend_per_decade * _polar(hints, lat) / 10
    excess = np.zeros_like(t)
    extra_amp = np.zeros_like(t)
    for h, w in zip(hints.hotspots, weights):
        if w < 1e-6:
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


def _seasonal(amp: float | np.ndarray, peak_month: int, lat: float, months: np.ndarray) -> np.ndarray:
    peak = peak_month if lat >= 0 else (peak_month + 6 - 1) % 12 + 1
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
    t = decimal_years(index)
    months = index.month.to_numpy()

    rng = np.random.default_rng(
        stable_seed(variable.id, round(bbox.west, 4), round(bbox.south, 4), round(bbox.east, 4), round(bbox.north, 4))
    )
    lats, lons = _grid(bbox)
    c_lat, c_lon = bbox.center
    background = _background_trend(hints, variable.id, c_lat, c_lon, t)
    dip = _dip_factor(hints, index)
    # Noise grows with the local level (noise_rel), following the level as it changes over time.
    c_weights = [_hotspot_weight(c_lat, c_lon, h) for h in hints.hotspots]
    c_local, _ = _hotspot_terms(hints, c_weights, c_lat, t)
    center_level = hints.base + hints.base_lat * abs(c_lat) + background + dip * c_local
    noise_sd = hints.noise + hints.noise_lat * abs(c_lat) + hints.noise_rel * np.abs(center_level)
    shared_noise = _ar1(rng, n, hints.ar1, 1.0) * noise_sd

    cube = np.empty((n, len(lats), len(lons)))
    for i, lat in enumerate(lats):
        for j, lon in enumerate(lons):
            weights = [_hotspot_weight(lat, lon, h) for h in hints.hotspots]
            excess, extra_amp = _hotspot_terms(hints, weights, lat, t)
            amp = np.maximum(0.0, hints.amp + hints.amp_lat * abs(lat) + dip * extra_amp)
            base = hints.base + hints.base_lat * abs(lat)
            local_noise = rng.normal(0, 1.0, size=n) * noise_sd * 0.3
            value = (
                base + _seasonal(amp, hints.peak_month, lat, months) + background + dip * excess
                + shared_noise + local_noise
            )
            cube[:, i, j] = np.clip(value, hints.min, hints.max)

    values = _apply_gaps(area_mean(cube, lats), hints, rng)
    return pd.Series(values, index=index, name=variable.id)


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
