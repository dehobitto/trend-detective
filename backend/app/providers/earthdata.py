"""NASA Earthdata provider: real GES DISC data (GLDAS, GPM IMERG, OMI NO₂, MERRA-2) and LP DAAC MODIS
monthly grids (MOD11C3 land surface temperature, MOD13C2 NDVI) via OPeNDAP.

Ported from the team's data-access module (github.com/evheniikozlov/nasa2026, ``data_access.py``):
same products, same grids, same "server-side subsetting" idea — for each granule we ask OPeNDAP for
just the grid cells inside the bbox (DAP4 constraint expression, ~1 KB per request) instead of the
global file, then take the cos(lat)-weighted area mean here.

Serves catalog variables whose ``access`` is ``Giovanni`` / ``GES DISC OPeNDAP``; ``product`` is
``"<ShortName>.<version>:<Variable>"`` (e.g. ``GLDAS_CLSM025_DA1_D.2.2:GWS_tavg``).

Flow for one request (variable, bbox, start..end):
1. Granule list from CMR (public, no login): date + OPeNDAP URL per granule, cached on disk per year.
2. Daily products are sampled on a few days per month (:data:`GRIDS` ``days``), like the team's
   ``prefetch.py`` (1st of the month for GLDAS: ~250 requests for 20 years instead of ~7600).
3. Each missing granule: ``<url>.dap.nc4?dap4.ce=/<path>[t][i0:i1][j0:j1]`` with an Earthdata session
   (``earthaccess``), area mean, stored in a per-(product, grid box) JSON cache. Requests run in parallel.
4. Calendar-month mean -> ``variable.to_catalog_units``.

The variable's full path and dimension order come from the granule's ``.dmr`` (fetched once per product),
so HDF-EOS groups (OMNO2d) and IMERG's ``(time, lon, lat)`` layout need no hard-coded templates.

Login: ``TD_EARTHDATA_TOKEN`` (or ``EARTHDATA_TOKEN``), or ``TD_EARTHDATA_USERNAME`` +
``TD_EARTHDATA_PASSWORD`` (or ``EARTHDATA_USERNAME`` / ``EARTHDATA_PASSWORD``, the team's ``.env`` names).
Without a login, values already in the cache are still served (run ``python -m app.prefetch`` once with a
login to make the demo work offline).
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import math
import os
import tempfile
import threading
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
import numpy as np
import pandas as pd

from app.catalog.models import CatalogVariable
from app.config import Settings
from app.providers.base import ProviderError, register_provider, report_progress
from app.schemas.common import BBox

log = logging.getLogger(__name__)

CMR_GRANULES_URL = "https://cmr.earthdata.nasa.gov/search/granules.umm_json"
CMR_PAGE_SIZE = 2000
DAP4_NS = "{http://xml.opendap.org/ns/DAP/4.0#}"
MIN_COVERAGE = 0.5
"""Without a login, serve cached values only if at least this share of the requested granules is cached."""


@dataclass(frozen=True)
class Grid:
    """Regular lat/lon grid of one product (cell centers), from the team's ``_GRIDS``."""

    lat_start: float
    lat_step: float
    lat_n: int
    lon_start: float
    lon_step: float
    lon_n: int
    days: tuple[int, ...] | None = None
    """Daily products: days of the month to sample. None = monthly product, use every granule."""
    positive_only: bool = False
    """Values <= 0 are fill values (OMI NO₂ uses ~-1e30)."""
    packing: tuple[tuple[str, float], ...] = ()
    """Packing attributes that override the file's: MODIS VI files say ``scale_factor = 10000`` but mean
    *divide* by it (HDF4 MODIS convention), so the real multiplier is given here."""


GRIDS: dict[str, Grid] = {
    # GLDAS CLSM 2.2 daily, 0.25°, lat -59.875..89.875. Groundwater changes slowly: one day per month.
    "GLDAS_CLSM025_DA1_D": Grid(-59.875, 0.25, 600, -179.875, 0.25, 1440, days=(1,)),
    # IMERG monthly, 0.1° (DAP dims are (time, lon, lat); handled via the DMR).
    "GPM_3IMERGM": Grid(-89.95, 0.1, 1800, -179.95, 0.1, 3600),
    # OMI NO₂ daily L3, 0.25°. Clouds blank out many days, so sample four per month.
    "OMNO2d": Grid(-89.875, 0.25, 720, -179.875, 0.25, 1440, days=(1, 8, 15, 22), positive_only=True),
    # MERRA-2 aerosol monthly means, 0.5° x 0.625°.
    "M2TMNXAER": Grid(-90.0, 0.5, 361, -180.0, 0.625, 576),
    # MODIS Terra monthly 0.05° climate-modeling grids (LP DAAC cloud OPeNDAP). Rows run north -> south.
    # LST: UInt16 * 0.02 -> Kelvin, fill 0 (both read from the file).
    "MOD11C3": Grid(89.975, -0.05, 3600, -179.975, 0.05, 7200),
    # NDVI: Int16 / 10000, fill -3000.
    "MOD13C2": Grid(89.975, -0.05, 3600, -179.975, 0.05, 7200, packing=(("scale_factor", 1e-4), ("add_offset", 0.0))),
}

_LAT_NAMES = {"lat", "latitude", "ydim", "nlat"}
_LON_NAMES = {"lon", "longitude", "xdim", "nlon"}
_TIME_NAMES = {"time"}
PACKING_ATTRS = ("_FillValue", "missing_value", "scale_factor", "add_offset")


# ---------------------------------------------------------------- pure helpers (unit-tested) ------------


def parse_product(product: str) -> tuple[str, str, str]:
    """``"GLDAS_CLSM025_DA1_D.2.2:GWS_tavg"`` -> ``("GLDAS_CLSM025_DA1_D", "2.2", "GWS_tavg")``."""
    try:
        short_and_version, field = product.split(":", 1)
        short_name, version = short_and_version.split(".", 1)
    except ValueError:
        raise ProviderError(f"Unexpected product id {product!r}.") from None
    return short_name, version, field


def cell_range(start: float, step: float, n: int, low: float, high: float) -> tuple[int, int]:
    """Inclusive index range of the grid cells (centers ``start + i*step``) overlapping ``[low, high)``.

    A cell that only touches the box edge is left out; a box smaller than one cell still gets that cell.
    """
    if step < 0:  # rows stored north -> south: solve on the mirrored (ascending) grid, then flip back
        a, b = cell_range(start + step * (n - 1), -step, n, low, high)
        return n - 1 - b, n - 1 - a
    # round away float noise so a box edge exactly on a cell edge (33.8 on a 0.05° grid) stays an edge
    i_low = math.floor(round((low - start) / step + 0.5, 6))
    i_high = math.ceil(round((high - start) / step + 0.5, 6)) - 1
    i_low, i_high = max(0, min(n - 1, i_low)), max(0, min(n - 1, i_high))
    return i_low, max(i_low, i_high)


@dataclass(frozen=True)
class Box:
    """Grid index box covering a bbox (also the cache key: nearby bboxes on the same cells share it)."""

    lat0: int
    lat1: int
    lon0: int
    lon1: int

    @classmethod
    def for_bbox(cls, grid: Grid, bbox: BBox) -> "Box":
        lat0, lat1 = cell_range(grid.lat_start, grid.lat_step, grid.lat_n, bbox.south, bbox.north)
        lon0, lon1 = cell_range(grid.lon_start, grid.lon_step, grid.lon_n, bbox.west, bbox.east)
        return cls(lat0, lat1, lon0, lon1)

    def lats(self, grid: Grid) -> np.ndarray:
        return grid.lat_start + grid.lat_step * np.arange(self.lat0, self.lat1 + 1)

    @property
    def key(self) -> str:
        return f"{self.lat0}-{self.lat1}_{self.lon0}-{self.lon1}"


@dataclass(frozen=True)
class VarLayout:
    """Where a variable lives in a granule and the role of each of its dimensions."""

    path: str
    """Fully qualified DAP4 name, e.g. ``/HDFEOS/GRIDS/ColumnAmountNO2/Data_Fields/ColumnAmountNO2TropCloudScreened``."""
    dims: tuple[str, ...]
    """``"time"``, ``"lat"`` or ``"lon"`` per dimension, in storage order."""
    attrs: tuple[tuple[str, float], ...] = ()
    """Packing attributes from the DMR (``scale_factor``, ``add_offset``, ``_FillValue``, ``missing_value``):
    used when the subset file itself does not carry them."""

    @property
    def group(self) -> str | None:
        parent = self.path.rsplit("/", 1)[0].strip("/")
        return parent or None

    @property
    def name(self) -> str:
        return self.path.rsplit("/", 1)[1]

    def constraint(self, box: Box) -> str:
        parts = {"time": "[0]", "lat": f"[{box.lat0}:{box.lat1}]", "lon": f"[{box.lon0}:{box.lon1}]"}
        return self.path + "".join(parts[d] for d in self.dims)


def _dim_role(dim_name: str) -> str:
    base = dim_name.rsplit("/", 1)[-1].lower()
    if base in _TIME_NAMES:
        return "time"
    # HDF-EOS grids served from HDF4 name them per grid, e.g. "YDim_MODIS_MONTHLY_0_05DEG_CMG_LST".
    if base in _LAT_NAMES or base.startswith("ydim_"):
        return "lat"
    if base in _LON_NAMES or base.startswith("xdim_"):
        return "lon"
    raise ProviderError(f"Unexpected dimension {dim_name!r} in the NASA data file.")


def parse_dmr(xml_text: str, field: str) -> VarLayout:
    """Find ``field`` in a DAP4 DMR document: its full path and dimension roles."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        raise ProviderError("NASA's data server sent an unreadable file description.") from exc

    def walk(node: ET.Element, prefix: str):
        for child in node:
            tag = child.tag.removeprefix(DAP4_NS)
            name = child.get("name")
            if tag == "Group" and name:
                yield from walk(child, f"{prefix}/{name}")
            elif name == field and child.findall(f"{DAP4_NS}Dim"):
                yield f"{prefix}/{name}", child

    for path, element in walk(root, ""):
        dims = tuple(_dim_role(d.get("name", "")) for d in element.findall(f"{DAP4_NS}Dim"))
        if sorted(d for d in dims if d != "time") != ["lat", "lon"]:
            raise ProviderError(f"{field} in the NASA data file is not a lat/lon grid.")
        attrs = []
        for attr in element.findall(f"{DAP4_NS}Attribute"):
            name = attr.get("name", "")
            value = attr.find(f"{DAP4_NS}Value")
            if name in PACKING_ATTRS and value is not None and value.text:
                try:
                    attrs.append((name, float(value.text.strip())))
                except ValueError:
                    pass
        return VarLayout(path=path, dims=dims, attrs=tuple(attrs))
    raise ProviderError(f"{field} was not found in the NASA data file.")


def decode_subset(
    content: bytes, layout: VarLayout, n_lat: int, n_lon: int, positive_only: bool = False,
    overrides: tuple[tuple[str, float], ...] = (),
) -> np.ndarray:
    """One DAP4 NetCDF-4 response as a decoded ``(lat, lon)`` float array (NaN = missing).

    Packing (fill value, scale factor, offset) is applied here from the file's own attributes, falling back
    to the DMR's, so it is applied exactly once whatever the server copies into the subset file.
    """
    import xarray as xr  # heavy import, only needed for real downloads

    with tempfile.NamedTemporaryFile(suffix=".nc4", delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name
    try:
        with xr.open_dataset(tmp_path, engine="h5netcdf", group=layout.group, mask_and_scale=False) as ds:
            if layout.name not in ds:
                raise ProviderError(f"{layout.name} is missing from NASA's response.")
            var = ds[layout.name]
            values = np.asarray(var.values, dtype=float)
            file_attrs = {k: var.attrs.get(k, var.encoding.get(k)) for k in PACKING_ATTRS}
    except (OSError, ValueError) as exc:
        raise ProviderError("NASA's data server sent an unreadable file.") from exc
    finally:
        os.unlink(tmp_path)
    packing = dict(layout.attrs)
    packing.update({k: float(np.ravel(v)[0]) for k, v in file_attrs.items() if v is not None})
    packing.update(dict(overrides))

    # The time index is a single slice ([0]); whether DAP keeps it as a size-1 axis or drops it, the
    # remaining cells are in storage order of the two spatial dims.
    spatial = [d for d in layout.dims if d != "time"]
    if values.size != n_lat * n_lon:
        raise ProviderError("NASA's response has an unexpected shape.")
    values = values.reshape((n_lat, n_lon) if spatial == ["lat", "lon"] else (n_lon, n_lat))
    if spatial == ["lon", "lat"]:
        values = values.T
    for key in ("_FillValue", "missing_value"):
        if key in packing:
            values = np.where(values == packing[key], np.nan, values)
    values = values * packing.get("scale_factor", 1.0) + packing.get("add_offset", 0.0)
    values = np.where(np.abs(values) >= 1e30, np.nan, values)  # HDF-EOS fill values without attributes
    values = np.where(values <= -9990, np.nan, values)  # GLDAS / IMERG -9999
    if positive_only:
        values = np.where(values > 0, values, np.nan)
    return values


def weighted_sum(values: np.ndarray, lats: np.ndarray) -> tuple[float, float]:
    """(sum of cos(lat)-weighted values, sum of weights) over the valid cells."""
    weights = np.cos(np.deg2rad(lats))[:, None] * np.ones_like(values)
    weights = np.where(np.isnan(values), 0.0, weights)
    return float(np.nansum(values * weights)), float(weights.sum())


def read_subset(content: bytes, layout: VarLayout, grid: Grid, box: Box) -> float:
    """Area mean of one DAP4 NetCDF-4 response (NaN when every cell is missing)."""
    n_lat, n_lon = box.lat1 - box.lat0 + 1, box.lon1 - box.lon0 + 1
    values = decode_subset(content, layout, n_lat, n_lon, positive_only=grid.positive_only, overrides=grid.packing)
    total, weight = weighted_sum(values, box.lats(grid))
    return total / weight if weight > 0 else float("nan")


def sample_dates(granules: dict[dt.date, str], grid: Grid, start: dt.date, end: dt.date) -> list[dt.date]:
    """The granule dates to use for ``start..end`` (daily products: only ``grid.days`` of each month)."""
    picked = [d for d in granules if start <= d <= end]
    if grid.days is not None:
        picked = [d for d in picked if d.day in grid.days]
    return sorted(picked)


def granules_from_umm(items: list[dict[str, Any]]) -> dict[dt.date, str]:
    """``{granule start date: OPeNDAP URL}`` from CMR UMM-JSON items."""
    out: dict[dt.date, str] = {}
    for item in items:
        umm = item.get("umm", {})
        begin = umm.get("TemporalExtent", {}).get("RangeDateTime", {}).get("BeginningDateTime", "")
        url = next(
            (u["URL"] for u in umm.get("RelatedUrls", [])
             if u.get("Type") == "USE SERVICE API" and "opendap" in u.get("URL", "").lower()),
            None,
        )
        if begin and url:
            out[dt.date.fromisoformat(begin[:10])] = url
    return out


# ---------------------------------------------------------------- provider -------------------------------


class EarthdataProvider:
    """Real GES DISC data through OPeNDAP subsetting, cached on disk."""

    name = "earthdata"

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._cache_dir = Path(settings.cache_dir) / "earthdata"
        self._timeout = settings.http_timeout
        self._workers = max(1, settings.earthdata_workers)
        self._lock = threading.Lock()
        self._logged_in = False
        self._layouts: dict[str, VarLayout] = {}
        self._local = threading.local()

    # -- configuration ---------------------------------------------------------------------------------

    @property
    def has_login(self) -> bool:
        s = self._settings
        return bool(s.earthdata_token or (s.earthdata_username and s.earthdata_password))

    # -- public API ------------------------------------------------------------------------------------

    def fetch(self, variable: CatalogVariable, bbox: BBox | None, start: dt.date, end: dt.date) -> pd.Series:
        short_name, version, field = parse_product(variable.product)
        grid = GRIDS.get(short_name)
        if grid is None:
            raise ProviderError(f"{variable.name} ({short_name}) is not supported by the NASA Earthdata reader yet.")
        if bbox is None:
            raise ProviderError(f"{variable.name} needs an area on the map.")
        box = Box.for_bbox(grid, bbox)
        cache_key = f"{short_name}.{version}:{field}"
        if not self.has_login and not self._values_path(short_name, cache_key, box).exists():
            raise ProviderError(
                f"Real NASA data for {variable.name} in this area is not downloaded yet and no Earthdata login "
                "is set (TD_EARTHDATA_TOKEN)."
            )

        granules = self._granules(short_name, version, start, end)
        dates = sample_dates(granules, grid, start, end)
        if not dates:
            raise ProviderError(f"NASA has no {variable.name} data between {start} and {end}.")

        cached = self._read_values(short_name, cache_key, box)
        missing = [d for d in dates if d.isoformat() not in cached]
        if missing:
            if self.has_login:
                fetched = self._download_values(short_name, version, field, grid, box, {d: granules[d] for d in missing})
                cached = self._merge_values(short_name, cache_key, box, fetched)
            elif len(missing) > (1 - MIN_COVERAGE) * len(dates):
                raise ProviderError(
                    "Real NASA data for this area is not downloaded yet and no Earthdata login is set "
                    "(TD_EARTHDATA_TOKEN)."
                )

        raw = pd.Series(
            [cached.get(d.isoformat()) for d in dates], index=pd.DatetimeIndex(dates), dtype=float
        )
        if raw.notna().sum() == 0:
            raise ProviderError(f"NASA has no valid {variable.name} values for this area (all cells empty).")
        monthly = raw.resample("MS").mean()
        full = pd.date_range(pd.Timestamp(start).replace(day=1), pd.Timestamp(end), freq="MS")
        monthly = monthly.reindex(full).astype(float)
        return variable.to_catalog_units(monthly).rename(variable.id)

    # -- granule list (CMR, public) --------------------------------------------------------------------

    def _granules(self, short_name: str, version: str, start: dt.date, end: dt.date) -> dict[dt.date, str]:
        out: dict[dt.date, str] = {}
        this_year = dt.date.today().year
        for year in range(start.year, end.year + 1):
            path = self._cache_dir / short_name / "granules" / f"{version}_{year}.json"
            # Past years never change; the current year is searched again once a day for new granules.
            fresh = path.exists() and (year < this_year or time.time() - path.stat().st_mtime < 86400)
            if fresh:
                data = json.loads(path.read_text(encoding="utf-8"))
            else:
                data = {d.isoformat(): u for d, u in self._search_year(short_name, version, year).items()}
                _write_json(path, data)
            out.update({dt.date.fromisoformat(d): u for d, u in data.items()})
        return out

    def _search_year(self, short_name: str, version: str, year: int) -> dict[dt.date, str]:
        params = {
            "short_name": short_name,
            "version": version,
            "temporal": f"{year}-01-01T00:00:00Z,{year}-12-31T23:59:59Z",
            "page_size": CMR_PAGE_SIZE,
        }
        headers: dict[str, str] = {}
        found: dict[dt.date, str] = {}
        try:
            for _ in range(20):  # 366 daily granules fit in one page; guard against endless paging
                r = self._cmr_get(params, headers)
                items = r.json().get("items", [])
                found.update(granules_from_umm(items))
                after = r.headers.get("CMR-Search-After")
                if not after or len(items) < CMR_PAGE_SIZE:
                    break
                headers["CMR-Search-After"] = after
        except (httpx.HTTPError, ValueError) as exc:
            log.warning("CMR search failed for %s %s %s: %s", short_name, version, year, exc)
            raise ProviderError("Couldn't reach NASA's data search (CMR). Please try again later.") from exc
        # CMR returns granules overlapping the range: keep only this year's.
        return {d: u for d, u in found.items() if d.year == year}

    def _cmr_get(self, params: dict[str, Any], headers: dict[str, str], attempts: int = 3) -> httpx.Response:
        """CMR drops connections now and then: retry a few times with a short pause."""
        for attempt in range(attempts):
            try:
                r = httpx.get(CMR_GRANULES_URL, params=params, headers=headers, timeout=self._timeout)
                r.raise_for_status()
                r.json()  # a truncated body is a failed attempt too
                return r
            except (httpx.HTTPError, ValueError):
                if attempt == attempts - 1:
                    raise
                time.sleep(1.5 * (attempt + 1))
        raise AssertionError("unreachable")

    # -- downloads (OPeNDAP, needs login) --------------------------------------------------------------

    def _session(self):
        session = getattr(self._local, "session", None)
        if session is None:
            import earthaccess

            session = earthaccess.get_requests_https_session()
            from requests.adapters import HTTPAdapter  # bigger pool: no "pool is full" warnings at 16 workers

            session.mount("https://", HTTPAdapter(pool_connections=4, pool_maxsize=self._workers))
            self._local.session = session
        return session

    def _login(self) -> None:
        with self._lock:
            if self._logged_in:
                return
            import earthaccess

            s = self._settings
            env = {
                "EARTHDATA_TOKEN": s.earthdata_token,
                "EARTHDATA_USERNAME": s.earthdata_username,
                "EARTHDATA_PASSWORD": s.earthdata_password,
            }
            for key, value in env.items():
                if value:
                    os.environ[key] = value
            try:
                auth = earthaccess.login(strategy="environment")
            except Exception as exc:  # earthaccess raises plain exceptions
                log.warning("Earthdata login failed: %s", exc)
                raise ProviderError("NASA Earthdata login failed. Check the Earthdata token or password.") from exc
            if auth is None or not getattr(auth, "authenticated", True):
                raise ProviderError("NASA Earthdata login failed. Check the Earthdata token or password.")
            self._logged_in = True

    def _get(self, url: str) -> bytes:
        try:
            response = self._session().get(url, timeout=self._timeout)
        except Exception as exc:  # requests exceptions; keep the dependency optional for tests
            raise ProviderError("Couldn't reach NASA's data server. Please try again later.") from exc
        if response.status_code in (401, 403):
            raise ProviderError("NASA Earthdata refused the login (check the token, and that GES DISC is authorized).")
        if response.status_code >= 400:
            raise ProviderError(f"NASA's data server answered with an error ({response.status_code}).")
        return response.content

    def _layout(self, short_name: str, field: str, sample_url: str) -> VarLayout:
        key = f"{short_name}:{field}"
        if key in self._layouts:
            return self._layouts[key]
        path = self._cache_dir / short_name / "layout.json"
        stored = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        if field in stored:
            entry = stored[field]
            layout = VarLayout(path=entry["path"], dims=tuple(entry["dims"]),
                               attrs=tuple((k, float(v)) for k, v in entry.get("attrs", {}).items()))
        else:
            layout = parse_dmr(self._get(f"{sample_url}.dmr").decode("utf-8", "replace"), field)
            stored[field] = {"path": layout.path, "dims": list(layout.dims), "attrs": dict(layout.attrs)}
            _write_json(path, stored)
        self._layouts[key] = layout
        return layout

    def _download_values(
        self, short_name: str, version: str, field: str, grid: Grid, box: Box, urls: dict[dt.date, str]
    ) -> dict[str, float | None]:
        self._login()
        layout = self._layout(short_name, field, next(iter(urls.values())))
        ce = layout.constraint(box)
        log.info("Earthdata: %d granules of %s.%s:%s for box %s", len(urls), short_name, version, field, box.key)

        def one(item: tuple[dt.date, str]) -> tuple[str, float | None, str | None]:
            date, url = item
            try:
                value = read_subset(self._get(f"{url}.dap.nc4?dap4.ce={ce}"), layout, grid, box)
            except ProviderError as exc:
                return date.isoformat(), None, str(exc)
            return date.isoformat(), (None if math.isnan(value) else value), None

        results: dict[str, float | None] = {}
        errors: list[str] = []
        total = len(urls)
        step = max(1, total // 100)
        report_progress(0, total)
        with ThreadPoolExecutor(max_workers=self._workers) as pool:
            for done, (date, value, error) in enumerate(pool.map(one, urls.items()), start=1):
                if done % step == 0 or done == total:
                    report_progress(done, total)
                if error is None:
                    results[date] = value
                else:
                    errors.append(error)
        if errors:
            log.warning("Earthdata: %d of %d granules failed (first: %s)", len(errors), len(urls), errors[0])
        if not results and errors:
            raise ProviderError(errors[0])
        return results

    # -- value cache ------------------------------------------------------------------------------------

    def _values_path(self, short_name: str, cache_key: str, box: Box) -> Path:
        safe = cache_key.replace(":", "_").replace("/", "_")
        return self._cache_dir / short_name / "values" / f"{safe}_{box.key}.json"

    def _read_values(self, short_name: str, cache_key: str, box: Box) -> dict[str, float | None]:
        path = self._values_path(short_name, cache_key, box)
        try:
            return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        except (OSError, ValueError):
            log.warning("Ignoring unreadable Earthdata cache %s", path)
            return {}

    def _merge_values(
        self, short_name: str, cache_key: str, box: Box, new: dict[str, float | None]
    ) -> dict[str, float | None]:
        with self._lock:
            merged = self._read_values(short_name, cache_key, box)
            merged.update(new)
            _write_json(self._values_path(short_name, cache_key, box), dict(sorted(merged.items())))
            return merged


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(f".tmp{os.getpid()}.{threading.get_ident()}")
    tmp.write_text(json.dumps(data, indent=0), encoding="utf-8")
    tmp.replace(path)


@register_provider("earthdata")
def _factory(settings: Settings) -> EarthdataProvider:
    return EarthdataProvider(settings)
