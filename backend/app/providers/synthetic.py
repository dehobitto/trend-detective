"""Deterministic synthetic data so the whole app works without NASA credentials.

For a request we lay a small grid over the bbox and build, per grid point,

    value = base(lat) + amp(lat) * cos(2π (month - peak) / 12) + trend * years_since_2000 + red_noise

then take the cos-latitude weighted area mean. The trend is shared across the bbox and comes from a
smooth function of the bbox center (plus "hotspots" from the catalog), so nearby boxes give similar
answers and distant regions can give opposite ones. Noise is AR(1) and seeded from a hash of
(variable, bbox), and is generated over the whole availability window before slicing, so the same
request always gives the same numbers and changing the dates just shows a different window.
"""

from __future__ import annotations

import datetime as dt
import hashlib

import numpy as np
import pandas as pd

from app.catalog.models import CatalogVariable, SyntheticHints
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


def _hotspot_weight(lat: float, lon: float, h_lat: float, h_lon: float, radius: float) -> float:
    dlat = lat - h_lat
    dlon = (lon - h_lon) * np.cos(np.deg2rad((lat + h_lat) / 2))
    return float(np.exp(-(dlat**2 + dlon**2) / radius**2))


def trend_per_year(hints: SyntheticHints, variable_id: str, lat: float, lon: float) -> float:
    """Region-dependent linear trend (units/year) at a location."""
    rng = np.random.default_rng(stable_seed("phase", variable_id))
    p1, p2 = rng.uniform(0, 2 * np.pi, size=2)
    wave = np.sin(np.deg2rad(lat) * 3 + p1) * np.cos(np.deg2rad(lon) * 2 + p2)
    factor = hints.bias + hints.spread * wave
    factor += sum(h.trend * _hotspot_weight(lat, lon, h.lat, h.lon, h.radius) for h in hints.hotspots)
    factor *= 1 + hints.polar_amplification * max(0.0, abs(lat) - 55) / 35
    return float(hints.trend_per_decade * factor / 10)


def _base_offset(hints: SyntheticHints, lat: float, lon: float) -> float:
    return sum(h.base * _hotspot_weight(lat, lon, h.lat, h.lon, h.radius) for h in hints.hotspots)


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


def generate(variable: CatalogVariable, bbox: BBox) -> pd.Series:
    """Full-availability monthly series for (variable, bbox)."""
    hints = variable.synthetic
    if hints is None:
        raise ProviderError(f"No synthetic data is configured for {variable.name}.")
    index = pd.date_range(variable.available_start, variable.available_end, freq="MS")
    n = len(index)
    years = decimal_years(index) - TREND_ORIGIN_YEAR
    months = index.month.to_numpy()

    rng = np.random.default_rng(
        stable_seed(variable.id, round(bbox.west, 4), round(bbox.south, 4), round(bbox.east, 4), round(bbox.north, 4))
    )
    lats, lons = _grid(bbox)
    c_lat, c_lon = bbox.center
    slope = trend_per_year(hints, variable.id, c_lat, c_lon)
    noise_sd = hints.noise + hints.noise_lat * abs(c_lat)
    shared_noise = _ar1(rng, n, hints.ar1, noise_sd)

    cube = np.empty((n, len(lats), len(lons)))
    for i, lat in enumerate(lats):
        peak = hints.peak_month if lat >= 0 else (hints.peak_month + 6 - 1) % 12 + 1
        amp = max(0.0, hints.amp + hints.amp_lat * abs(lat))
        seasonal = amp * np.cos(2 * np.pi * (months - peak) / 12)
        for j, lon in enumerate(lons):
            base = hints.base + hints.base_lat * abs(lat) + _base_offset(hints, lat, lon)
            local_noise = rng.normal(0, noise_sd * 0.3, size=n)
            cube[:, i, j] = np.clip(base + seasonal + slope * years + shared_noise + local_noise, hints.min, hints.max)

    values = area_mean(cube, lats)
    if hints.gap_fraction > 0:
        values[rng.random(n) < hints.gap_fraction] = np.nan
    return pd.Series(values, index=index, name=variable.id)


class SyntheticProvider:
    """Deterministic demo data. Results are flagged ``synthetic: true``."""

    name = "synthetic"
    synthetic = True
    local = True

    def fetch(self, variable: CatalogVariable, bbox: BBox | None, start: dt.date, end: dt.date) -> pd.Series:
        if bbox is None:
            raise ProviderError("An area (bbox) is required.")
        series = generate(variable, bbox)
        return series.loc[pd.Timestamp(start).replace(day=1):pd.Timestamp(end)]


@register_provider("synthetic")
def _factory(settings: Settings) -> SyntheticProvider:
    return SyntheticProvider()
