"""Map frames for the time slider: ``GET /api/grid/{variable_id}`` and ``/dates``.

Frames are synthetic for now (``synthetic: true``), produced by the same model as the synthetic area
series (``providers.synthetic.grid_values``), so the heatmap tells the same story as the chart. Land-only
variables are null over the ocean (``landmask.land_fraction`` < 0.5). Frames are cached as ready-to-send
JSON bytes, so repeated slider positions cost nothing.
"""

from __future__ import annotations

import datetime as dt
import json
import math
import threading
from functools import lru_cache

import numpy as np
import pandas as pd

from app.catalog import Catalog
from app.catalog.models import CatalogVariable
from app.grid.change import MIN_YEARS, diverging_colormap, monthly_climatology, trend_fields, value_cube
from app.grid.landmask import land_fraction
from app.providers.synthetic import grid_values
from app.schemas.common import BBox

MAX_CELLS = 200
"""Hard cap on the grid size along each axis."""
DEFAULT_CELLS = 160
"""Without ``res``, the longer side of the bbox gets this many cells ..."""
DEFAULT_MIN_RES = 0.1
"""... but never finer than this (degrees), about the resolution of the real products."""
LAND_THRESHOLD = 0.5
RANGE_PERCENTILES = (2.0, 98.0)
RANGE_SAMPLE_RES = 2.0
RANGE_SAMPLE_MONTHS = 24

GLOBAL_BBOX = BBox(west=-180, south=-90, east=180, north=90)
TREND_GLOBAL_RES = 2.0
"""Default cell size (degrees) of a whole-globe trend grid (180x90): answers cold in well under a second."""
CHANGE_SAMPLE_RES = 3.0
"""Coarse global grid used to fix the (stable) anomaly / trend color ranges."""
CHANGE_RANGE_PERCENTILE = 98.0
HOTSPOT_RANGE_SHARE = 0.75
HOTSPOT_RANGE_CAP = 5.0
"""The trend range covers this share of the strongest catalog hotspot's slope (its core may saturate), but at
most HOTSPOT_RANGE_CAP x the background 98th percentile, so the rest of the world stays readable."""


class GridNotAvailable(LookupError):
    """Unknown variable, or one without a map (``series``): 404."""


class GridRequestError(ValueError):
    """A bad request (date outside availability, ...): 422."""


def grid_shape(bbox: BBox, res: float | None) -> tuple[int, int]:
    """(width, height) in cells for ``bbox`` at ``res`` degrees (default from the bbox size), each ≤ MAX_CELLS."""
    w, h = bbox.east - bbox.west, bbox.north - bbox.south
    if res is None:
        res = max(max(w, h) / DEFAULT_CELLS, DEFAULT_MIN_RES)
    width = int(np.clip(math.ceil(w / res - 1e-9), 1, MAX_CELLS))
    height = int(np.clip(math.ceil(h / res - 1e-9), 1, MAX_CELLS))
    return width, height


def cell_edges(bbox: BBox, width: int, height: int) -> tuple[np.ndarray, np.ndarray]:
    """Latitude edges north -> south (height+1) and longitude edges west -> east (width+1)."""
    return np.linspace(bbox.north, bbox.south, height + 1), np.linspace(bbox.west, bbox.east, width + 1)


def _centers(edges: np.ndarray) -> np.ndarray:
    return (edges[:-1] + edges[1:]) / 2


def _weighted_percentiles(values: np.ndarray, weights: np.ndarray, q: tuple[float, ...]) -> list[float]:
    order = np.argsort(values)
    v, w = values[order], weights[order]
    cum = (np.cumsum(w) - 0.5 * w) / w.sum()
    return [float(np.interp(p / 100, cum, v)) for p in q]


def _nice(x: float, up: bool) -> float:
    """Round to 2 significant digits, outward (``up`` for a maximum)."""
    if x == 0 or not math.isfinite(x):
        return 0.0
    exponent = math.floor(math.log10(abs(x))) - 1
    step = 10.0**exponent
    return round((math.ceil(x / step) if up else math.floor(x / step)) * step, max(0, -exponent))


class GridService:
    def __init__(self, catalog: Catalog) -> None:
        self.catalog = catalog
        self._frame_json = lru_cache(maxsize=512)(self._build_frame_json)
        self._range = lru_cache(maxsize=64)(self._compute_range)
        self._colormap = lru_cache(maxsize=64)(self._build_colormap)
        self._anomaly_json = lru_cache(maxsize=256)(self._build_anomaly_json)
        self._climatology = lru_cache(maxsize=16)(self._compute_climatology)
        self._anomaly_r = lru_cache(maxsize=64)(self._compute_anomaly_range)
        self._trend_json = lru_cache(maxsize=64)(self._build_trend_json)
        self._trend_r = lru_cache(maxsize=64)(self._compute_trend_range)

    # ------------------------------------------------------------------ public

    def variable(self, variable_id: str) -> CatalogVariable:
        variable = self.catalog.get(variable_id)
        if variable is None:
            raise GridNotAvailable(f"Unknown variable '{variable_id}'.")
        if variable.is_series:
            raise GridNotAvailable(
                f"'{variable_id}' ({variable.name}) is a single ready-made record (coverage \"series\"), "
                "so it has no map grid."
            )
        return variable

    def dates(self, variable_id: str) -> list[str]:
        variable = self.variable(variable_id)
        index = pd.date_range(variable.available_start, variable.available_end, freq="MS")
        return [d.strftime("%Y-%m-%d") for d in index]

    def frame_json(
        self, variable_id: str, date: dt.date, bbox: BBox | None, res: float | None, mode: str = "value"
    ) -> bytes:
        """Serialized ``GridFrame`` (cached). ``mode="anomaly"``: value minus that calendar month's climatology."""
        variable = self.variable(variable_id)
        month = date.replace(day=1)
        first, last = variable.available_start.replace(day=1), variable.available_end
        if not first <= month <= last:
            raise GridRequestError(
                f"No {variable.name} data for {month:%Y-%m}: it is available from {first:%Y-%m} to {last:%Y-%m}."
            )
        bbox = bbox or GLOBAL_BBOX
        width, height = grid_shape(bbox, res)
        key = _key(bbox)
        if mode == "anomaly":
            return self._anomaly_json(variable_id, month, key, width, height)
        if mode != "value":
            raise GridRequestError(f"Unknown mode '{mode}': use value or anomaly.")
        return self._frame_json(variable_id, month, key, width, height)

    def trend_json(
        self, variable_id: str, start: dt.date, end: dt.date, bbox: BBox | None, res: float | None, alpha: float = 0.05
    ) -> bytes:
        """Serialized ``TrendGrid`` (cached); the period is clamped to the variable's availability."""
        variable = self.variable(variable_id)
        months = pd.date_range(variable.available_start, variable.available_end, freq="MS")
        first, last = months[0].date(), months[-1].date()
        s, e = max(start.replace(day=1), first), min(end.replace(day=1), last)
        if s > e:
            raise GridRequestError(
                f"No {variable.name} data between {start:%Y-%m} and {end:%Y-%m}: "
                f"it is available from {first:%Y-%m} to {last:%Y-%m}."
            )
        if e.year - s.year + 1 < MIN_YEARS or (e.year - s.year) * 12 + e.month - s.month + 1 < MIN_YEARS * 12:
            raise GridRequestError(f"A trend map needs at least {MIN_YEARS} years of data; pick a longer period.")
        if not 0 < alpha < 1:
            raise GridRequestError("alpha must be between 0 and 1.")
        if bbox is None and res is None:
            res = TREND_GLOBAL_RES
        bbox = bbox or GLOBAL_BBOX
        width, height = grid_shape(bbox, res)
        return self._trend_json(variable_id, s, e, _key(bbox), width, height, round(alpha, 6))

    def trend(self, variable_id: str, start: dt.date, end: dt.date, bbox: BBox | None = None,
              res: float | None = None, alpha: float = 0.05) -> dict:
        return json.loads(self.trend_json(variable_id, start, end, bbox, res, alpha))

    def anomaly_range(self, variable_id: str) -> float:
        return self._anomaly_r(variable_id)

    def trend_range(self, variable_id: str) -> float:
        return self._trend_r(variable_id)

    def frame(
        self, variable_id: str, date: dt.date, bbox: BBox | None = None, res: float | None = None, mode: str = "value"
    ) -> dict:
        return json.loads(self.frame_json(variable_id, date, bbox, res, mode))

    def value_range(self, variable_id: str) -> tuple[float, float]:
        return self._range(variable_id)

    def prewarm(self) -> None:
        """Compute the color ranges of all area variables (each takes ~0.2 s the first time)."""
        for variable in self.catalog.variables():
            if not variable.is_series:
                self._range(variable.id)
        for variable in self.catalog.variables():
            if not variable.is_series:
                self._anomaly_r(variable.id)
                self._trend_r(variable.id)

    def prewarm_in_background(self) -> threading.Thread:
        thread = threading.Thread(target=self.prewarm, name="grid-prewarm", daemon=True)
        thread.start()
        return thread

    # ------------------------------------------------------------------ internals

    def _mask(self, variable: CatalogVariable, lat_edges: np.ndarray, lon_edges: np.ndarray) -> np.ndarray | None:
        """Boolean (rows, cols) of cells that have data, or None when every cell does."""
        if variable.coverage not in ("land", "ocean"):
            return None
        land = land_fraction(lat_edges, lon_edges) >= LAND_THRESHOLD
        return land if variable.coverage == "land" else ~land

    def _cube(self, variable: CatalogVariable, index: pd.DatetimeIndex, bbox: BBox, width: int, height: int):
        lat_edges, lon_edges = cell_edges(bbox, width, height)
        mask = self._mask(variable, lat_edges, lon_edges)
        return value_cube(variable, index, _centers(lat_edges), _centers(lon_edges), mask)

    def _compute_climatology(self, variable_id: str, key: tuple, width: int, height: int) -> np.ndarray:
        """(12, rows, cols) calendar-month means over the whole availability (built one calendar month at a time)."""
        variable = self.variable(variable_id)
        bbox = BBox(west=key[0], south=key[1], east=key[2], north=key[3])
        index = pd.date_range(variable.available_start, variable.available_end, freq="MS")
        out = np.full((12, height, width), np.nan)
        for m in range(1, 13):
            sub = index[index.month == m]
            if len(sub):
                out[m - 1] = self._cube(variable, sub, bbox, width, height).mean(axis=0)
        return out

    def _compute_anomaly_range(self, variable_id: str) -> float:
        """Symmetric range R (anomalies span -R..R): 98th percentile of |anomaly| over a coarse global sample."""
        variable = self.variable(variable_id)
        index = pd.date_range(variable.available_start, variable.available_end, freq="MS")
        width, height = grid_shape(GLOBAL_BBOX, CHANGE_SAMPLE_RES)
        cube = self._cube(variable, index, GLOBAL_BBOX, width, height)
        anom = np.abs(cube - monthly_climatology(cube, index.month.to_numpy())[index.month.to_numpy() - 1])
        return self._symmetric_range(anom, height, width)

    def _compute_trend_range(self, variable_id: str) -> float:
        """Symmetric range R for slopes per decade over the full record (coarse global sample), widened so the
        strongest catalog hotspot reaches at least HOTSPOT_RANGE_SHARE of it."""
        variable = self.variable(variable_id)
        index = pd.date_range(variable.available_start, variable.available_end, freq="MS")
        width, height = grid_shape(GLOBAL_BBOX, CHANGE_SAMPLE_RES)
        slope, _ = trend_fields(self._cube(variable, index, GLOBAL_BBOX, width, height), index)
        r = self._symmetric_range(np.abs(slope)[None], height, width)
        background = r
        hotspots = variable.synthetic.hotspots if variable.synthetic else []
        if hotspots:
            lats = np.array([h.lat for h in hotspots])
            lons = np.array([h.lon for h in hotspots])
            at = value_cube(variable, index, lats, lons)
            at = np.stack([at[:, i, i] for i in range(len(hotspots))], axis=1)[:, :, None]
            hs, _ = trend_fields(at, index)
            hot = HOTSPOT_RANGE_SHARE * float(np.nanmax(np.abs(hs)))
            r = max(r, _nice(min(hot, HOTSPOT_RANGE_CAP * background), up=True))
        return r

    def _symmetric_range(self, absval: np.ndarray, height: int, width: int) -> float:
        lat_edges, _ = cell_edges(GLOBAL_BBOX, width, height)
        weights = np.broadcast_to(np.cos(np.deg2rad(_centers(lat_edges)))[:, None], (height, width))
        weights = np.broadcast_to(weights, absval.shape)
        ok = np.isfinite(absval)
        if not ok.any():
            return 1.0
        (hi,) = _weighted_percentiles(absval[ok], weights[ok], (CHANGE_RANGE_PERCENTILE,))
        hi = _nice(hi, up=True)
        return hi if hi > 0 else 1.0

    def _build_anomaly_json(self, variable_id: str, month: dt.date, key: tuple, width: int, height: int) -> bytes:
        variable = self.variable(variable_id)
        bbox = BBox(west=key[0], south=key[1], east=key[2], north=key[3])
        values = self._values(variable, month, bbox, width, height)
        anom = values - self._climatology(variable_id, key, width, height)[month.month - 1]
        r = self._anomaly_r(variable_id)
        return _dump({
            "variable_id": variable.id,
            "date": month.isoformat(),
            "bbox": bbox.model_dump(),
            "width": width,
            "height": height,
            "values": _rounded(anom, r),
            "min": -r,
            "max": r,
            "units": variable.units,
            "colormap": diverging_colormap(r),
            "synthetic": True,
        })

    def _build_trend_json(
        self, variable_id: str, start: dt.date, end: dt.date, key: tuple, width: int, height: int, alpha: float
    ) -> bytes:
        variable = self.variable(variable_id)
        bbox = BBox(west=key[0], south=key[1], east=key[2], north=key[3])
        index = pd.date_range(start, end, freq="MS")
        slope, p = trend_fields(self._cube(variable, index, bbox, width, height), index)
        r = self._trend_r(variable_id)
        ok = np.isfinite(slope) & np.isfinite(p)
        significant = np.where(ok, p < alpha, None).ravel().tolist()
        return _dump({
            "variable_id": variable.id,
            "date": end.isoformat(),
            "start": start.isoformat(),
            "end": end.isoformat(),
            "bbox": bbox.model_dump(),
            "width": width,
            "height": height,
            "values": _rounded(np.where(ok, slope, np.nan), r),
            "significant": significant,
            "min": -r,
            "max": r,
            "units": f"{variable.units} per decade",
            "colormap": diverging_colormap(r),
            "synthetic": True,
        })

    def _values(self, variable: CatalogVariable, month: dt.date, bbox: BBox, width: int, height: int) -> np.ndarray:
        lat_edges, lon_edges = cell_edges(bbox, width, height)
        values = grid_values(variable, pd.Timestamp(month), _centers(lat_edges), _centers(lon_edges))
        if variable.coverage in ("land", "ocean"):
            land = land_fraction(lat_edges, lon_edges) >= LAND_THRESHOLD
            values = np.where(land if variable.coverage == "land" else ~land, values, np.nan)
        return values

    def _compute_range(self, variable_id: str) -> tuple[float, float]:
        """Stable color range for a variable (same for every frame and area).

        Area-weighted 2nd-98th percentile of a global sample over the whole record, widened so the
        catalog's hotspots stay readable: each hotspot's median value (at its center, over the record) is
        kept inside the range (otherwise a polluted city or a depleted aquifer would be one saturated blob).
        """
        variable = self.variable(variable_id)
        index = pd.date_range(variable.available_start, variable.available_end, freq="MS")
        months = index[np.linspace(0, len(index) - 1, RANGE_SAMPLE_MONTHS).round().astype(int)]
        width, height = grid_shape(GLOBAL_BBOX, RANGE_SAMPLE_RES)
        lat_edges, _ = cell_edges(GLOBAL_BBOX, width, height)
        weights = np.repeat(np.cos(np.deg2rad(_centers(lat_edges)))[:, None], width, axis=1)
        samples, sample_w = [], []
        for m in months:
            v = self._values(variable, m.date(), GLOBAL_BBOX, width, height)
            ok = np.isfinite(v)
            samples.append(v[ok])
            sample_w.append(weights[ok])
        lo, hi = _weighted_percentiles(np.concatenate(samples), np.concatenate(sample_w), RANGE_PERCENTILES)
        hotspots = variable.synthetic.hotspots if variable.synthetic else []
        if hotspots:
            lats = np.array([h.lat for h in hotspots])
            lons = np.array([h.lon for h in hotspots])
            at_centers = np.array([np.diag(grid_values(variable, m, lats, lons)) for m in months])
            medians = np.median(at_centers, axis=0)
            lo, hi = min(lo, float(medians.min())), max(hi, float(medians.max()))
        lo, hi = _nice(lo, up=False), _nice(hi, up=True)
        if variable.synthetic is not None:
            lo = max(lo, variable.synthetic.min)
        if hi <= lo:
            hi = lo + 1.0
        return lo, hi

    def _build_colormap(self, variable_id: str) -> dict:
        variable = self.variable(variable_id)
        lo, hi = self._range(variable_id)
        name = variable.colormap or "inferno"
        stops = [[round(lo + p * (hi - lo), 6), color] for p, color in self.catalog.colormap(name)]
        return {"name": name, "stops": stops}

    def _build_frame_json(
        self, variable_id: str, month: dt.date, key: tuple[float, float, float, float], width: int, height: int
    ) -> bytes:
        variable = self.variable(variable_id)
        bbox = BBox(west=key[0], south=key[1], east=key[2], north=key[3])
        values = self._values(variable, month, bbox, width, height)
        lo, hi = self._range(variable_id)
        decimals = max(0, 3 - math.floor(math.log10(hi - lo)))
        rounded = np.round(values, decimals).ravel().astype(object)
        rounded[~np.isfinite(values.ravel())] = None
        frame = {
            "variable_id": variable.id,
            "date": month.isoformat(),
            "bbox": bbox.model_dump(),
            "width": width,
            "height": height,
            "values": rounded.tolist(),
            "min": lo,
            "max": hi,
            "units": variable.units,
            "colormap": self._colormap(variable_id),
            "synthetic": True,
        }
        return json.dumps(frame, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()


def _key(bbox: BBox) -> tuple[float, float, float, float]:
    return (round(bbox.west, 4), round(bbox.south, 4), round(bbox.east, 4), round(bbox.north, 4))


def _rounded(values: np.ndarray, span: float) -> list:
    decimals = max(0, 4 - math.floor(math.log10(span)))
    out = np.round(values, decimals).ravel().astype(object)
    out[~np.isfinite(values.ravel())] = None
    return out.tolist()


def _dump(obj: dict) -> bytes:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()
