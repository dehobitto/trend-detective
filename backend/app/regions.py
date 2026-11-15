"""Named areas (countries, states, cities): the OSM boundary approximated by grid squares.

``GET /api/regions/shape?osm=R60199`` looks the boundary up on OSM Nominatim (``/lookup`` with
``polygon_geojson``), then covers it with squares on a global grid (multiples of the square size, so the
same squares recur across regions). The square size is the smallest of :data:`STEPS` that needs at most
:data:`MAX_CELLS` squares; a square is kept when the boundary covers at least :data:`MIN_COVER` of it.

The analysis then averages only inside those squares: providers weight the product's grid cells whose
centres fall in a square (``providers.base.fetch_mask``), so a country's average leaves out the sea and
the neighbours its bounding box would include. The outline (simplified) is returned for drawing.
"""

from __future__ import annotations

import json
import logging
import math
import re
import threading
from pathlib import Path

import httpx
from pydantic import BaseModel
from shapely.geometry import box, mapping, shape
from shapely.ops import unary_union

from app.schemas.common import BBox

log = logging.getLogger(__name__)

STEPS = (0.1, 0.25, 0.5, 1.0, 2.0, 3.0, 5.0)
MAX_CELLS = 300
"""Squares are only a mask (no extra downloads), so the cap is about drawing them, not speed."""
MIN_COVER = 0.35
MAX_SPAN_DEG = (90.0, 60.0)
"""Width and height limits: beyond that a region is too big to analyse as one area."""
OSM_ID = re.compile(r"^[NWR]\d{1,12}$")


class RegionError(ValueError):
    """Unknown id, no boundary, or a region the app cannot use (e.g. crossing the 180° line)."""


class RegionShape(BaseModel):
    osm: str
    name: str
    kind: str
    outline: dict
    """Simplified boundary as a GeoJSON geometry (Polygon or MultiPolygon), for drawing."""
    cells: list[BBox]
    """The squares the analysis averages over."""
    cell_deg: float
    bbox: BBox
    """Bounding box of the squares (what the map frames and what providers subset)."""


def approximate(geometry: dict, *, max_cells: int = MAX_CELLS) -> tuple[list[BBox], float, BBox, dict]:
    """(squares, square size, squares' bbox, simplified outline) for a GeoJSON Polygon/MultiPolygon."""
    geom = shape(geometry)
    if geom.is_empty or geom.geom_type not in ("Polygon", "MultiPolygon"):
        raise RegionError("This place has no area boundary (it is a point or a line).")
    if not geom.is_valid:
        geom = geom.buffer(0)
    west, south, east, north = geom.bounds
    if east - west > MAX_SPAN_DEG[0] or north - south > MAX_SPAN_DEG[1]:
        raise RegionError("This region is too big to analyse as one area (or it crosses the 180° line). Draw a smaller area instead.")

    chosen: list[tuple[float, float, float, float]] = []
    step = STEPS[-1]
    for step in STEPS:
        x0, y0 = math.floor(west / step) * step, math.floor(south / step) * step
        nx, ny = math.ceil((east - x0) / step), math.ceil((north - y0) / step)
        if nx * ny > max_cells * 6 and step != STEPS[-1]:
            continue  # far too many candidates; skip straight to a coarser grid
        cells = []
        for j in range(ny):
            for i in range(nx):
                w, s = x0 + i * step, y0 + j * step
                sq = box(w, s, w + step, s + step)
                if sq.intersects(geom) and sq.intersection(geom).area >= MIN_COVER * sq.area:
                    cells.append((w, s, w + step, s + step))
        if not cells:  # a region smaller than one square: keep the squares it touches
            cells = [
                (x0 + i * step, y0 + j * step, x0 + (i + 1) * step, y0 + (j + 1) * step)
                for j in range(ny) for i in range(nx)
                if box(x0 + i * step, y0 + j * step, x0 + (i + 1) * step, y0 + (j + 1) * step).intersects(geom)
            ]
        if len(cells) <= max_cells:
            chosen = cells
            break
        chosen = cells
    r = lambda v: round(v, 6)  # noqa: E731  (grid multiples print cleanly)
    squares = [BBox(west=r(w), south=r(s), east=r(e), north=r(n)) for w, s, e, n in chosen]
    union = BBox(west=min(c.west for c in squares), south=min(c.south for c in squares),
                 east=max(c.east for c in squares), north=max(c.north for c in squares))
    outline = mapping(geom.simplify(min(step / 6, 0.05), preserve_topology=True))
    return squares, step, union, json.loads(json.dumps(outline))


def cells_union_area(cells: list[BBox]) -> float:
    """Area of the squares in square degrees (for sanity checks / tests)."""
    return unary_union([box(c.west, c.south, c.east, c.north) for c in cells]).area


class RegionService:
    """Nominatim boundary lookup + approximation, cached in memory and on disk."""

    def __init__(self, client: httpx.Client, lookup_url: str, cache_dir: Path, throttle) -> None:
        self._client = client
        self._lookup_url = lookup_url
        self._cache_dir = cache_dir / "regions"
        self._throttle = throttle
        self._memo: dict[str, RegionShape] = {}
        self._lock = threading.Lock()

    def shape(self, osm: str) -> RegionShape:
        osm = osm.strip().upper()
        if not OSM_ID.match(osm):
            raise RegionError("Unknown place id.")
        with self._lock:
            if osm in self._memo:
                return self._memo[osm]
        path = self._cache_dir / f"{osm}.json"
        if path.exists():
            try:
                region = RegionShape.model_validate_json(path.read_text(encoding="utf-8"))
                with self._lock:
                    self._memo[osm] = region
                return region
            except ValueError:
                log.warning("Ignoring unreadable region cache %s", path)
        item = self._lookup(osm)
        cells, step, union, outline = approximate(item["geojson"])
        region = RegionShape(
            osm=osm,
            name=item.get("name") or (item.get("display_name") or "").split(",")[0] or osm,
            kind=item.get("addresstype") or item.get("type") or "area",
            outline=outline, cells=cells, cell_deg=step, bbox=union,
        )
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(region.model_dump_json(), encoding="utf-8")
        with self._lock:
            self._memo[osm] = region
        return region

    def _lookup(self, osm: str) -> dict:
        params = {"osm_ids": osm, "format": "jsonv2", "polygon_geojson": 1, "polygon_threshold": 0.005, "accept-language": "en"}
        try:
            with self._throttle():
                r = self._client.get(self._lookup_url, params=params)
            r.raise_for_status()
            data = r.json()
        except (httpx.HTTPError, ValueError) as exc:
            log.warning("Nominatim lookup failed for %s: %s", osm, exc)
            raise RegionError("Couldn't get the boundary of this place right now. Try again, or draw the area.") from exc
        if not data or "geojson" not in data[0]:
            raise RegionError("No boundary found for this place. Draw the area instead.")
        return data[0]
