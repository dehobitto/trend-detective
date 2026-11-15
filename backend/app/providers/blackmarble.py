"""NASA Black Marble provider: VIIRS nighttime lights (VNP46A3 monthly composites) via LAADS OPeNDAP.

The team's code (github.com/evheniikozlov/nasa2026, ``data_access.get_data_ntl``) uses ``blackmarblepy``,
which downloads whole 10°x10° HDF5 tiles (~150 MB per year for one city). Here we keep the same product
family (VIIRS Black Marble, "NearNadir_Composite_Snow_Free" radiance, the blackmarblepy default) but ask
LAADS' OPeNDAP server for only the pixels inside the bbox, like the GES DISC products.

Black Marble is tiled, not one global grid: tile ``hHHvVV`` covers lon ``-180 + 10*HH .. +10`` and lat
``90 - 10*VV .. -10`` with 2400 x 2400 pixels of 15 arc-seconds, rows running north -> south. A bbox can
span several tiles; for each month every tile's cos(lat)-weighted sum is fetched and the sums are combined.

Granules come from CMR (``bounding_box`` = the bbox, one search per year, cached). Values (nW·cm⁻²·sr⁻¹,
packed uint16 with scale 0.1 and fill 65535 — decoded from the file / DMR attributes) are cached per bbox
in ``TD_CACHE_DIR/blackmarble/``. Login, session and DMR handling are shared with :mod:`earthdata`; the
Earthdata token works for LAADS.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import math
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from app.catalog.models import CatalogVariable
from app.config import Settings
from app.providers.base import ProviderError, current_mask, mask_grid, mask_key, register_provider
from app.providers.earthdata import EarthdataProvider, VarLayout, _write_json, decode_subset, parse_product, weighted_sum
from app.schemas.common import BBox

log = logging.getLogger(__name__)

TILE_DEG = 10.0
TILE_PIXELS = 2400
PIXEL_DEG = TILE_DEG / TILE_PIXELS
_TILE_RE = re.compile(r"\.h(\d{2})v(\d{2})\.")


@dataclass(frozen=True)
class TileWindow:
    """The pixel window of one tile that falls inside a bbox (inclusive indices, rows north -> south)."""

    h: int
    v: int
    row0: int
    row1: int
    col0: int
    col1: int

    @property
    def tile(self) -> str:
        return f"h{self.h:02d}v{self.v:02d}"

    def lats(self) -> np.ndarray:
        north = 90.0 - TILE_DEG * self.v
        return north - PIXEL_DEG * (np.arange(self.row0, self.row1 + 1) + 0.5)

    def lons(self) -> np.ndarray:
        west = -180.0 + TILE_DEG * self.h
        return west + PIXEL_DEG * (np.arange(self.col0, self.col1 + 1) + 0.5)

    def constraint(self, layout: VarLayout) -> str:
        parts = {"time": "[0]", "lat": f"[{self.row0}:{self.row1}]", "lon": f"[{self.col0}:{self.col1}]"}
        return layout.path + "".join(parts[d] for d in layout.dims)


def tile_windows(bbox: BBox) -> list[TileWindow]:
    """Every tile the bbox touches, with the pixel window inside the bbox (edge-touching pixels excluded)."""
    eps = 1e-9
    h0, h1 = int((bbox.west + 180) // TILE_DEG), int((bbox.east + 180 - eps) // TILE_DEG)
    v0, v1 = int((90 - bbox.north) // TILE_DEG), int((90 - bbox.south - eps) // TILE_DEG)
    windows = []
    for v in range(max(0, v0), min(17, v1) + 1):
        north, south = 90.0 - TILE_DEG * v, 90.0 - TILE_DEG * (v + 1)
        row0 = math.floor((north - min(bbox.north, north)) / PIXEL_DEG + eps)
        row1 = math.ceil((north - max(bbox.south, south)) / PIXEL_DEG - eps) - 1
        for h in range(max(0, h0), min(35, h1) + 1):
            west, east = -180.0 + TILE_DEG * h, -180.0 + TILE_DEG * (h + 1)
            col0 = math.floor((max(bbox.west, west) - west) / PIXEL_DEG + eps)
            col1 = math.ceil((min(bbox.east, east) - west) / PIXEL_DEG - eps) - 1
            row1c, col1c = min(TILE_PIXELS - 1, max(row0, row1)), min(TILE_PIXELS - 1, max(col0, col1))
            windows.append(TileWindow(h, v, row0, row1c, col0, col1c))
    return windows


def granules_by_tile(items: list[dict[str, Any]]) -> dict[str, dict[str, str]]:
    """``{date iso: {tile: OPeNDAP URL}}`` from CMR UMM-JSON items (LAADS lists ``….h5.html`` pages)."""
    out: dict[str, dict[str, str]] = {}
    for item in items:
        umm = item.get("umm", {})
        begin = umm.get("TemporalExtent", {}).get("RangeDateTime", {}).get("BeginningDateTime", "")
        url = next((u["URL"] for u in umm.get("RelatedUrls", [])
                    if u.get("Type") == "USE SERVICE API" and "opendap" in u.get("URL", "").lower()), None)
        if not begin or not url:
            continue
        match = _TILE_RE.search(url) or _TILE_RE.search(item.get("meta", {}).get("native-id", ""))
        if match is None:
            continue
        url = url.removesuffix(".html")
        out.setdefault(begin[:10], {})[f"h{match.group(1)}v{match.group(2)}"] = url
    return out


class BlackMarbleProvider(EarthdataProvider):
    """VIIRS Black Marble monthly nighttime lights, subset per tile through LAADS OPeNDAP."""

    name = "blackmarble"

    def __init__(self, settings: Settings) -> None:
        super().__init__(settings)
        self._cache_dir = Path(settings.cache_dir) / "blackmarble"

    def fetch(self, variable: CatalogVariable, bbox: BBox | None, start: dt.date, end: dt.date) -> pd.Series:
        short_name, version, field = parse_product(variable.product)
        if bbox is None:
            raise ProviderError(f"{variable.name} needs an area on the map.")
        squares = current_mask()
        if squares:
            # Named region: per tile, only the window around its own squares; tiles with no square are skipped.
            windows = []
            for w in tile_windows(bbox):
                tile_west, tile_north = -180.0 + TILE_DEG * w.h, 90.0 - TILE_DEG * w.v
                tile = BBox(west=tile_west, south=tile_north - TILE_DEG, east=tile_west + TILE_DEG, north=tile_north)
                mine = [c for c in squares if c.west < tile.east and c.east > tile.west and c.south < tile.north and c.north > tile.south]
                if not mine:
                    continue
                sub = BBox(west=max(tile.west, min(c.west for c in mine)), south=max(tile.south, min(c.south for c in mine)),
                           east=min(tile.east, max(c.east for c in mine)), north=min(tile.north, max(c.north for c in mine)))
                windows += [x for x in tile_windows(sub) if x.tile == w.tile]
        else:
            windows = tile_windows(bbox)
        key = "_".join(f"{x:.3f}" for x in (bbox.west, bbox.south, bbox.east, bbox.north)) + mask_key(squares)
        values_path = self._cache_dir / short_name / "values" / f"{version}_{field}_{key}.json"
        cached: dict[str, float | None] = json.loads(values_path.read_text(encoding="utf-8")) if values_path.exists() else {}
        if not self.has_login and not cached:
            raise ProviderError(
                f"Real NASA data for {variable.name} in this area is not downloaded yet and no Earthdata login "
                "is set (TD_EARTHDATA_TOKEN)."
            )

        needed_tiles = {w.tile for w in windows}
        granules = self._tile_granules(short_name, version, bbox, start, end)
        dates = sorted(d for d, tiles in granules.items()
                       if start.isoformat() <= d <= end.isoformat() and needed_tiles <= set(tiles))
        if not dates:
            raise ProviderError(f"NASA has no {variable.name} data for this area between {start} and {end}.")
        missing = [d for d in dates if d not in cached]
        if missing and self.has_login:
            cached.update(self._download(short_name, field, windows, {d: granules[d] for d in missing}, squares))
            _write_json(values_path, dict(sorted(cached.items())))
        elif missing and len(missing) > len(dates) / 2:
            raise ProviderError(
                f"Real NASA data for {variable.name} in this area is not downloaded yet and no Earthdata login is set."
            )

        raw = pd.Series([cached.get(d) for d in dates], index=pd.DatetimeIndex(dates), dtype=float)
        if raw.notna().sum() == 0:
            raise ProviderError(f"NASA has no valid {variable.name} values for this area.")
        monthly = raw.resample("MS").mean()
        full = pd.date_range(pd.Timestamp(start).replace(day=1), pd.Timestamp(end), freq="MS")
        return variable.to_catalog_units(monthly.reindex(full).astype(float)).rename(variable.id)

    # -- granules ---------------------------------------------------------------------------------------

    def _tile_granules(self, short_name: str, version: str, bbox: BBox, start: dt.date, end: dt.date):
        tiles_key = "-".join(sorted(w.tile for w in tile_windows(bbox)))
        out: dict[str, dict[str, str]] = {}
        this_year = dt.date.today().year
        for year in range(start.year, end.year + 1):
            path = self._cache_dir / short_name / "granules" / f"{version}_{tiles_key}_{year}.json"
            if path.exists() and year < this_year:
                data = json.loads(path.read_text(encoding="utf-8"))
            else:
                params = {
                    # LAADS registers VNP46A3 in CMR as version "2", not "002" (the file-name form): "002" finds nothing.
                    "short_name": short_name, "version": version.lstrip("0") or "0", "page_size": 2000,
                    "temporal": f"{year}-01-01T00:00:00Z,{year}-12-31T23:59:59Z",
                    "bounding_box": f"{bbox.west},{bbox.south},{bbox.east},{bbox.north}",
                }
                try:
                    items = self._cmr_get(params, {}).json().get("items", [])
                except Exception as exc:  # httpx errors / bad JSON after retries
                    raise ProviderError("Couldn't reach NASA's data search (CMR). Please try again later.") from exc
                data = {d: t for d, t in granules_by_tile(items).items() if d.startswith(str(year))}
                _write_json(path, data)
            out.update(data)
        return out

    # -- downloads ---------------------------------------------------------------------------------------

    def _download(self, short_name: str, field: str, windows: list[TileWindow],
                  granules: dict[str, dict[str, str]], squares=None) -> dict[str, float | None]:
        self._login()
        first_date = next(iter(granules))
        layout = self._layout(short_name, field, granules[first_date][windows[0].tile])
        jobs = [(d, w, tiles[w.tile]) for d, tiles in granules.items() for w in windows]
        log.info("Black Marble: %d tile subsets for %d months", len(jobs), len(granules))

        def one(job):
            date, window, url = job
            try:
                content = self._get(f"{url}.dap.nc4?dap4.ce={window.constraint(layout)}")
                n_lat, n_lon = window.row1 - window.row0 + 1, window.col1 - window.col0 + 1
                values = decode_subset(content, layout, n_lat, n_lon)
                values = np.where(values < 0, np.nan, values)
                if squares:
                    values = np.where(mask_grid(squares, window.lats(), window.lons()), values, np.nan)
                return date, weighted_sum(values, window.lats()), None
            except ProviderError as exc:
                return date, None, str(exc)

        sums: dict[str, list[float]] = {}
        failed: set[str] = set()
        errors: list[str] = []
        with ThreadPoolExecutor(max_workers=self._workers) as pool:
            for date, pair, error in pool.map(one, jobs):
                if error is not None:
                    failed.add(date)
                    errors.append(error)
                    continue
                acc = sums.setdefault(date, [0.0, 0.0])
                acc[0] += pair[0]
                acc[1] += pair[1]
        if errors:
            log.warning("Black Marble: %d subsets failed (first: %s)", len(errors), errors[0])
        results = {d: (s / w if w > 0 else None) for d, (s, w) in sums.items() if d not in failed}
        if not results and errors:
            raise ProviderError(errors[0])
        return results


@register_provider("blackmarble")
def _factory(settings: Settings) -> BlackMarbleProvider:
    return BlackMarbleProvider(settings)
