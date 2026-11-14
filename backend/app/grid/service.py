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

    def frame_json(self, variable_id: str, date: dt.date, bbox: BBox | None, res: float | None) -> bytes:
        """Serialized ``GridFrame`` (cached)."""
        variable = self.variable(variable_id)
        month = date.replace(day=1)
        first, last = variable.available_start.replace(day=1), variable.available_end
        if not first <= month <= last:
            raise GridRequestError(
                f"No {variable.name} data for {month:%Y-%m}: it is available from {first:%Y-%m} to {last:%Y-%m}."
            )
        bbox = bbox or GLOBAL_BBOX
        width, height = grid_shape(bbox, res)
        key = (round(bbox.west, 4), round(bbox.south, 4), round(bbox.east, 4), round(bbox.north, 4))
        return self._frame_json(variable_id, month, key, width, height)

    def frame(self, variable_id: str, date: dt.date, bbox: BBox | None = None, res: float | None = None) -> dict:
        return json.loads(self.frame_json(variable_id, date, bbox, res))

    def value_range(self, variable_id: str) -> tuple[float, float]:
        return self._range(variable_id)

    def prewarm(self) -> None:
        """Compute the color ranges of all area variables (each takes ~0.2 s the first time)."""
        for variable in self.catalog.variables():
            if not variable.is_series:
                self._range(variable.id)

    def prewarm_in_background(self) -> threading.Thread:
        thread = threading.Thread(target=self.prewarm, name="grid-prewarm", daemon=True)
        thread.start()
        return thread

    # ------------------------------------------------------------------ internals

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
