"""NASA Black Marble provider: VIIRS nighttime lights (VNP46A3 monthly composites) via LAADS OPeNDAP.

The team's code (github.com/evheniikozlov/nasa2026, ``data_access.get_data_ntl``) uses ``blackmarblepy``,
which downloads whole 10°x10° HDF5 tiles (~150 MB per year for one city). Here we keep the same product
family (VIIRS Black Marble, "NearNadir_Composite_Snow_Free" radiance, the blackmarblepy default) but ask
LAADS' OPeNDAP server for only the pixels inside the bbox, like the GES DISC products.

Black Marble is tiled, not one global grid: tile ``hHHvVV`` covers lon ``-180 + 10*HH .. +10`` and lat
``90 - 10*VV .. -10`` with 2400 x 2400 pixels of 15 arc-seconds, rows running north -> south. A bbox can
span several tiles; for each month every tile's cos(lat)-weighted sum is fetched and the sums are combined.

Granules come from CMR (``bounding_box`` = the bbox, one search per year, cached). Values (nW·cm⁻²·sr⁻¹,
packed uint16 with scale 0.1 and fill 65535 — decoded from the file / DMR attributes) are cached twice in
``TD_CACHE_DIR/blackmarble/``: the area mean per bbox (``values/``), and each tile window's weighted sum
(``tiles/``), so a moved or resized box reuses the tiles it shares with earlier boxes.

Big areas are slow (tiles x months requests), so downloads go in passes of one calendar month for every year
(October of every year first, then April, ...). After each pass the provider reports a preliminary annual series
for the whole area (:func:`app.providers.base.report_partial`): same quantity as the final result, only sparser. Login, session and DMR handling are shared with :mod:`earthdata`; the
Earthdata token works for LAADS.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import math
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from app.catalog.models import CatalogVariable
from app.config import Settings
from app.providers.base import (
    ProviderError, current_mask, mask_grid, mask_key, register_provider, report_partial, report_progress,
)
from app.providers.earthdata import EarthdataProvider, VarLayout, _write_json, decode_subset, parse_product, weighted_sum
from app.schemas.common import BBox

log = logging.getLogger(__name__)

TILE_DEG = 10.0
TILE_PIXELS = 2400
PIXEL_DEG = TILE_DEG / TILE_PIXELS
MAX_SAMPLES = 40_000
"""Pixels fetched per month at most (~200 x 200). A bigger area is sampled every ``stride``-th pixel."""
KM_PER_DEG = 111.0
STRIDES = (1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256)
"""Allowed strides: nearby box sizes land on the same stride, so their tile caches can be shared."""
PASS_ORDER = (10, 4, 1, 7, 12, 3, 9, 6, 11, 2, 8, 5)
"""Download order of calendar months. Each pass fetches one month of every year; the first few passes already
cover all four seasons. October and April come first: dark nights at every latitude (no midnight sun)."""
PREVIEW_MIN_JOBS = 200
"""Below this many tile requests (~15 s) the download is quick enough without preliminary results."""
PREVIEW_MIN_YEARS = 5
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
    stride: int = 1
    """Take every ``stride``-th row and column (OPeNDAP ``[start:stride:stop]``), for big areas."""

    @property
    def tile(self) -> str:
        return f"h{self.h:02d}v{self.v:02d}"

    def lats(self) -> np.ndarray:
        north = 90.0 - TILE_DEG * self.v
        return north - PIXEL_DEG * (np.arange(self.row0, self.row1 + 1, self.stride) + 0.5)

    def lons(self) -> np.ndarray:
        west = -180.0 + TILE_DEG * self.h
        return west + PIXEL_DEG * (np.arange(self.col0, self.col1 + 1, self.stride) + 0.5)

    def constraint(self, layout: VarLayout) -> str:
        step = f"{self.stride}:" if self.stride > 1 else ""
        parts = {"time": "[0]", "lat": f"[{self.row0}:{step}{self.row1}]", "lon": f"[{self.col0}:{step}{self.col1}]"}
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


def pick_stride(windows: list[TileWindow]) -> int:
    """Smallest stride that keeps one month of all windows under :data:`MAX_SAMPLES` pixels."""
    total = sum((w.row1 - w.row0 + 1) * (w.col1 - w.col0 + 1) for w in windows)
    raw = max(1, math.ceil(math.sqrt(total / MAX_SAMPLES)))
    return next((s for s in STRIDES if s >= raw), raw)


def pass_of(date: str) -> int:
    """Download pass of a month (``"2019-10-01"`` -> 0)."""
    return PASS_ORDER.index(int(date[5:7]))


def annual_preview(values: dict[str, float | None]) -> pd.Series:
    """Annual series from whatever months are in so far, without seasonal bias.

    Each month's values are taken as anomalies from that calendar month's mean over the years, averaged per
    year and shifted back to the overall level: a year missing its (cloudy, or not yet downloaded) June does
    not look darker or brighter than a year that has it.
    """
    s = pd.Series({pd.Timestamp(d): v for d, v in values.items()}, dtype=float).dropna()
    if s.empty:
        return pd.Series(dtype=float)
    table = s.groupby([s.index.year, s.index.month]).mean().unstack()  # rows = years, columns = months
    climatology = table.mean()
    yearly = table.sub(climatology, axis=1).mean(axis=1) + climatology.mean()
    return pd.Series(yearly.to_numpy(), index=pd.to_datetime([f"{y}-01-01" for y in yearly.index]), dtype=float)


def sampling_note(stride: int) -> str:
    km = stride * PIXEL_DEG * KM_PER_DEG
    return (f"This area is large, so night lights were sampled at one pixel in {stride * stride} "
            f"(about one point every {km:.0f} km) to keep the download fast. The trend and its significance "
            "are reliable; the exact brightness is approximate and very small towns may be missed.")


def preview_note(months: int, stride: int) -> str:
    sampled = f", sampled at one pixel in {stride * stride}" if stride > 1 else ""
    return (f"Preliminary: {months} of 12 months of every year are downloaded so far{sampled}, so each point is "
            "a yearly average. The full monthly result replaces this when the download finishes.")


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
        stride = pick_stride(windows)
        windows = [replace(w, stride=stride) for w in windows]
        key = "_".join(f"{x:.3f}" for x in (bbox.west, bbox.south, bbox.east, bbox.north)) + mask_key(squares)
        key += f"_s{stride}" if stride > 1 else ""  # full-resolution caches keep their old names
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
            known = {d: cached[d] for d in dates if d in cached}

            def on_pass(new: dict[str, float | None], months: int) -> None:
                preview = annual_preview({**known, **new})
                if preview.notna().sum() >= PREVIEW_MIN_YEARS:
                    preview = variable.to_catalog_units(preview).rename(variable.id)
                    report_partial(preview, preview_note(months, stride))

            cached.update(self._download(short_name, version, field, windows, {d: granules[d] for d in missing},
                                         squares, on_pass))
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
        series = variable.to_catalog_units(monthly.reindex(full).astype(float)).rename(variable.id)
        if stride > 1:
            series.attrs["notes"] = [sampling_note(stride)]
        return series

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

    def _tile_path(self, short_name: str, version: str, field: str, window: TileWindow, squares) -> Path:
        name = (f"{version}_{field}_{window.tile}_{window.row0}-{window.row1}_{window.col0}-{window.col1}"
                f"_s{window.stride}{mask_key(squares)}.json")
        return self._cache_dir / short_name / "tiles" / name

    def _download(self, short_name: str, version: str, field: str, windows: list[TileWindow],
                  granules: dict[str, dict[str, str]], squares=None, on_pass=None) -> dict[str, float | None]:
        """Area means for ``granules``' dates, from the tile cache where possible, downloading the rest in passes.

        ``on_pass(values, months)`` is called after each completed pass but the last (big downloads only) with
        every value known so far and how many calendar months of each year are in.
        """
        paths = {w: self._tile_path(short_name, version, field, w, squares) for w in windows}
        tiles: dict[TileWindow, dict[str, list[float]]] = {
            w: (json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}) for w, p in paths.items()
        }
        dates = sorted(granules, key=lambda d: (pass_of(d), d))
        jobs = [(d, w, granules[d][w.tile]) for d in dates for w in windows if d not in tiles[w]]

        results: dict[str, float | None] = {}
        failed: set[str] = set()

        def combine(upto: list[str]) -> None:
            for d in upto:
                if d in results or d in failed:
                    continue
                pairs = [tiles[w].get(d) for w in windows]
                if any(p is None for p in pairs):
                    failed.add(d)  # a tile failed: no mean of only part of the area
                    continue
                total, weight = sum(p[0] for p in pairs), sum(p[1] for p in pairs)
                results[d] = total / weight if weight > 0 else None

        def save() -> None:
            for w, p in paths.items():
                _write_json(p, dict(sorted(tiles[w].items())))

        if not jobs:
            combine(dates)
            return results

        self._login()
        layout = self._layout(short_name, field, jobs[0][2])
        log.info("Black Marble: %d tile subsets for %d months", len(jobs), len(granules))

        def one(job):
            date, window, url = job
            try:
                content = self._get(f"{url}.dap.nc4?dap4.ce={window.constraint(layout)}")
                n_lat, n_lon = len(window.lats()), len(window.lons())
                values = decode_subset(content, layout, n_lat, n_lon)
                values = np.where(values < 0, np.nan, values)
                if squares:
                    values = np.where(mask_grid(squares, window.lats(), window.lons()), values, np.nan)
                return date, window, weighted_sum(values, window.lats()), None
            except ProviderError as exc:
                return date, window, None, str(exc)

        # The last job of each pass: once pool.map (which keeps order) has yielded it, that pass is complete.
        pass_ends = {
            i: pass_of(job[0]) for i, job in enumerate(jobs)
            if i + 1 == len(jobs) or pass_of(jobs[i + 1][0]) != pass_of(job[0])
        }
        last_pass = pass_of(jobs[-1][0])
        preview = on_pass is not None and len(jobs) >= PREVIEW_MIN_JOBS
        errors: list[str] = []
        total = len(jobs)
        step = max(1, total // 100)
        report_progress(0, total)
        with ThreadPoolExecutor(max_workers=self._workers) as pool:
            for i, (date, window, pair, error) in enumerate(pool.map(one, jobs)):
                done = i + 1
                if done % step == 0 or done == total:
                    report_progress(done, total)
                if error is None:
                    tiles[window][date] = [float(pair[0]), float(pair[1])]
                else:
                    errors.append(error)
                if i in pass_ends:
                    save()  # an interrupted download keeps every finished pass
                    if preview and pass_ends[i] != last_pass:
                        combine([d for d in dates if pass_of(d) <= pass_ends[i]])
                        on_pass(dict(results), pass_ends[i] + 1)
        combine(dates)
        if errors:
            log.warning("Black Marble: %d subsets failed (first: %s)", len(errors), errors[0])
        if not results and errors:
            raise ProviderError(errors[0])
        return results


@register_provider("blackmarble")
def _factory(settings: Settings) -> BlackMarbleProvider:
    return BlackMarbleProvider(settings)
