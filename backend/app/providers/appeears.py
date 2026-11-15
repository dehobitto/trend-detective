"""NASA AppEEARS provider: MODIS land products (land surface temperature, NDVI) as area means.

Based on the team's AppEEARS code (github.com/evheniikozlov/nasa2026, ``data_access.get_data_appeears``):
same API, same "area" task (bbox polygon, geographic projection). Difference: instead of downloading every
GeoTIFF (gigabytes for 20 years) we download only the ``<PRODUCT>-Statistics.csv`` that AppEEARS puts in
every area-task bundle: one row per layer and date with the area ``Mean`` (fill values excluded), a few KB.

Serves catalog variables with ``access: AppEEARS``; ``product`` is ``"<Product>.<version>:<layer>"``,
e.g. ``MOD11A2.061:LST_Day_1km`` (8-day, 1 km) or ``MOD13A3.061:_1_km_monthly_NDVI``.

AppEEARS tasks are asynchronous and take minutes. One task per (product, layer, bbox) is submitted for
the variable's whole availability, so any later date range for that area is answered from the cache
(``TD_CACHE_DIR/appeears/``). A request waits up to ``TD_APPEEARS_WAIT`` seconds; if the task is still
running it fails with "NASA is preparing this area, try again in a few minutes" and the next request for
the same area polls the same task instead of submitting a new one. ``python -m app.prefetch`` submits all
example areas at once and waits for them.

Login: ``TD_EARTHDATA_USERNAME`` + ``TD_EARTHDATA_PASSWORD`` (AppEEARS ``POST /login``, preferred), or an
Earthdata bearer token ``TD_EARTHDATA_TOKEN`` used directly.
"""

from __future__ import annotations

import datetime as dt
import io
import json
import logging
import os
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
import numpy as np
import pandas as pd

from app.catalog.models import CatalogVariable
from app.config import Settings
from app.providers.base import ProviderError, register_provider
from app.schemas.common import BBox

log = logging.getLogger(__name__)

API = "https://appeears.earthdatacloud.nasa.gov/api"
TOKEN_TTL = 40 * 3600
"""AppEEARS login tokens live 48 h; renew a bit earlier."""


@dataclass(frozen=True)
class Layer:
    scale: float
    """Product scale factor (applied only if AppEEARS returned raw integers, see :func:`apply_scale`)."""
    valid_max: float
    """Largest valid value AFTER scaling; a median above it means the values are still raw integers."""


LAYERS: dict[tuple[str, str], Layer] = {
    ("MOD11A2.061", "LST_Day_1km"): Layer(scale=0.02, valid_max=1310.7),
    ("MOD11A2.061", "LST_Night_1km"): Layer(scale=0.02, valid_max=1310.7),
    ("MOD13A3.061", "_1_km_monthly_NDVI"): Layer(scale=0.0001, valid_max=1.0),
}


class TaskPending(ProviderError):
    """The AppEEARS task exists but is not finished yet."""


class TaskFailed(ProviderError):
    """AppEEARS itself reports the task as failed: a fresh task must be submitted."""


class Unreachable(ProviderError):
    """A network error or a 5xx from AppEEARS: transient, the task is still there."""


# ---------------------------------------------------------------- pure helpers (unit-tested) ------------


def parse_product(product: str) -> tuple[str, str]:
    """``"MOD11A2.061:LST_Day_1km"`` -> ``("MOD11A2.061", "LST_Day_1km")``."""
    if ":" not in product:
        raise ProviderError(f"Unexpected AppEEARS product id {product!r}.")
    name, layer = product.split(":", 1)
    return name, layer


def bbox_key(bbox: BBox) -> str:
    return "_".join(f"{v:.3f}" for v in (bbox.west, bbox.south, bbox.east, bbox.north))


def task_payload(name: str, product: str, layer: str, bbox: BBox, start: dt.date, end: dt.date) -> dict[str, Any]:
    w, s, e, n = bbox.west, bbox.south, bbox.east, bbox.north
    return {
        "task_type": "area",
        "task_name": name,
        "params": {
            "dates": [{"startDate": start.strftime("%m-%d-%Y"), "endDate": end.strftime("%m-%d-%Y")}],
            "layers": [{"product": product, "layer": layer}],
            "output": {"format": {"type": "geotiff"}, "projection": "geographic"},
            "geo": {
                "type": "FeatureCollection",
                "features": [{
                    "type": "Feature",
                    "properties": {},
                    "geometry": {"type": "Polygon", "coordinates": [[[w, s], [e, s], [e, n], [w, n], [w, s]]]},
                }],
            },
        },
    }


def statistics_file(files: list[dict[str, Any]], product: str) -> dict[str, Any] | None:
    """The ``<PRODUCT>-<version>-Statistics.csv`` entry of a bundle listing (not the QC statistics)."""
    stem = product.replace(".", "-").lower()
    for f in files:
        name = f.get("file_name", "").rsplit("/", 1)[-1].lower()
        if name.endswith("-statistics.csv") and name.startswith(stem) and "qc" not in name:
            return f
    for f in files:  # fall back to any non-QC statistics file
        name = f.get("file_name", "").lower()
        if name.endswith("statistics.csv") and "qc" not in name.rsplit("/", 1)[-1]:
            return f
    return None


def parse_statistics(text: str, layer: str) -> pd.Series:
    """Per-date area mean for ``layer`` from an AppEEARS statistics CSV (columns Dataset, Date, Mean, Count)."""
    try:
        table = pd.read_csv(io.StringIO(text))
    except (ValueError, pd.errors.ParserError) as exc:
        raise ProviderError("NASA AppEEARS sent statistics in an unexpected format.") from exc
    cols = {c.strip().lower(): c for c in table.columns}
    if "date" not in cols or "mean" not in cols:
        raise ProviderError("NASA AppEEARS statistics have no Date/Mean columns.")
    if "dataset" in cols:
        datasets = table[cols["dataset"]].astype(str)
        mine = table[datasets.str.contains(layer.strip("_"), regex=False)]
        table = mine if not mine.empty else table
    means = pd.to_numeric(table[cols["mean"]], errors="coerce")
    if "count" in cols:
        means = means.where(pd.to_numeric(table[cols["count"]], errors="coerce").fillna(0) > 0)
    dates = pd.to_datetime(table[cols["date"]], errors="coerce")
    series = pd.Series(means.to_numpy(dtype=float), index=pd.DatetimeIndex(dates)).dropna()
    series = series[series.index.notna()]
    return series.groupby(level=0).mean().sort_index()


def apply_scale(series: pd.Series, layer: Layer) -> pd.Series:
    """Apply the scale factor when AppEEARS reported raw stored integers (median beyond the valid range)."""
    valid = series.dropna()
    if not valid.empty and float(np.median(valid)) > layer.valid_max:
        return series * layer.scale
    return series


# ---------------------------------------------------------------- provider -------------------------------


class AppeearsProvider:
    """Real MODIS area means through AppEEARS area tasks, cached on disk."""

    name = "appeears"

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._cache_dir = Path(settings.cache_dir) / "appeears"
        self._timeout = settings.http_timeout
        self._wait = settings.appeears_wait
        self._poll = settings.appeears_poll
        self._token: tuple[str, float] | None = None
        self._lock = threading.Lock()
        self._key_locks: dict[str, threading.Lock] = {}

    @property
    def has_login(self) -> bool:
        s = self._settings
        return bool(s.earthdata_token or (s.earthdata_username and s.earthdata_password))

    # -- public API ------------------------------------------------------------------------------------

    def fetch(self, variable: CatalogVariable, bbox: BBox | None, start: dt.date, end: dt.date) -> pd.Series:
        raw = self.area_series(variable, bbox, wait=self._wait)
        monthly = raw.resample("MS").mean()
        full = pd.date_range(pd.Timestamp(start).replace(day=1), pd.Timestamp(end), freq="MS")
        monthly = monthly.reindex(full).astype(float)
        if monthly.notna().sum() == 0:
            raise ProviderError(f"NASA has no valid {variable.name} values for this area and period.")
        return variable.to_catalog_units(monthly).rename(variable.id)

    def area_series(self, variable: CatalogVariable, bbox: BBox | None, wait: float) -> pd.Series:
        """Per-date area means in native units for the variable's whole availability (cached)."""
        product, layer = parse_product(variable.product)
        layer_cfg = LAYERS.get((product, layer))
        if layer_cfg is None:
            raise ProviderError(f"{variable.name} ({product}) is not supported by the AppEEARS reader yet.")
        if bbox is None:
            raise ProviderError(f"{variable.name} needs an area on the map.")
        key = f"{product}_{layer}_{bbox_key(bbox)}"
        with self._key_lock(key):
            state = self._read_state(key)
            if "values" not in state:
                if not self.has_login:
                    raise ProviderError(
                        f"{variable.name} for this area is not downloaded yet and no Earthdata login is set "
                        "(TD_EARTHDATA_USERNAME / TD_EARTHDATA_PASSWORD)."
                    )
                if "task_id" not in state:
                    state["task_id"] = self._submit(key, product, layer, bbox, variable.available_start, variable.available_end)
                    state["submitted"] = time.time()
                    self._write_state(key, state)
                try:
                    self._wait_done(state["task_id"], wait)
                except TaskFailed:
                    self._write_state(key, {})  # only a task NASA reports as failed is dropped
                    raise
                values = self._download_statistics(state["task_id"], product, layer)
                state["values"] = {d.date().isoformat(): v for d, v in values.items()}
                self._write_state(key, state)
        series = pd.Series(state["values"], dtype=float)
        series.index = pd.DatetimeIndex(series.index)
        return apply_scale(series.sort_index(), layer_cfg)

    def start(self, variable: CatalogVariable, bbox: BBox) -> str:
        """Submit (or find) the task for an area without waiting; returns ``"cached"`` or the task id."""
        try:
            self.area_series(variable, bbox, wait=0)
            return "cached"
        except TaskPending:
            return self._read_state(f"{'_'.join(parse_product(variable.product))}_{bbox_key(bbox)}").get("task_id", "")

    # -- AppEEARS API ----------------------------------------------------------------------------------

    def _headers(self) -> dict[str, str]:
        with self._lock:
            if self._token and time.time() - self._token[1] < TOKEN_TTL:
                return {"Authorization": f"Bearer {self._token[0]}"}
            s = self._settings
            if s.earthdata_username and s.earthdata_password:
                try:
                    r = httpx.post(f"{API}/login", auth=(s.earthdata_username, s.earthdata_password), timeout=self._timeout)
                except httpx.HTTPError as exc:  # timeout / no connection: the password is not the problem
                    log.warning("AppEEARS login unreachable: %s", exc)
                    raise Unreachable("Couldn't reach NASA AppEEARS. Please try again later.") from exc
                if r.status_code >= 500:
                    log.warning("AppEEARS login -> %s", r.status_code)
                    raise Unreachable(f"NASA AppEEARS is having trouble right now ({r.status_code}). Please try again later.")
                try:
                    r.raise_for_status()
                    token = r.json()["token"]
                except (httpx.HTTPError, KeyError, ValueError) as exc:
                    log.warning("AppEEARS login failed: %s", exc)
                    raise ProviderError("NASA AppEEARS login failed. Check the Earthdata username and password.") from exc
            elif s.earthdata_token:
                token = s.earthdata_token
            else:
                raise ProviderError("No Earthdata login is set (TD_EARTHDATA_USERNAME / TD_EARTHDATA_PASSWORD).")
            self._token = (token, time.time())
            return {"Authorization": f"Bearer {token}"}

    def _request(self, method: str, path: str, **kwargs) -> httpx.Response:
        try:
            r = httpx.request(method, f"{API}{path}", headers=self._headers(), timeout=self._timeout, **kwargs)
        except httpx.HTTPError as exc:
            raise Unreachable("Couldn't reach NASA AppEEARS. Please try again later.") from exc
        if r.status_code in (401, 403):
            with self._lock:
                self._token = None
            raise ProviderError("NASA AppEEARS refused the login. Check the Earthdata username and password.")
        if r.status_code >= 500:
            log.warning("AppEEARS %s %s -> %s", method, path, r.status_code)
            raise Unreachable(f"NASA AppEEARS is having trouble right now ({r.status_code}). Please try again later.")
        if r.status_code >= 400:
            log.warning("AppEEARS %s %s -> %s %s", method, path, r.status_code, r.text[:300])
            raise ProviderError(f"NASA AppEEARS answered with an error ({r.status_code}).")
        return r

    def _submit(self, key: str, product: str, layer: str, bbox: BBox, start: dt.date, end: dt.date) -> str:
        name = f"trend-detective_{key}"[:100]
        existing = self._existing_task(name)
        if existing:
            log.info("AppEEARS task %s already exists for %s; reusing it", existing, key)
            return existing
        payload = task_payload(name, product, layer, bbox, start, end)
        task_id = self._request("POST", "/task", json=payload).json().get("task_id")
        if not task_id:
            raise ProviderError("NASA AppEEARS did not accept the request.")
        log.info("AppEEARS task %s submitted for %s", task_id, key)
        return task_id

    def _existing_task(self, name: str) -> str | None:
        """The live task of this account with this name that is closest to done (e.g. one submitted by a run
        that lost its state), or None."""
        try:
            tasks = self._request("GET", "/task", params={"limit": 200}).json()
        except (ProviderError, ValueError):
            return None
        live = [t for t in tasks if isinstance(t, dict) and t.get("task_name") == name
                and t.get("status") not in ("error", "deleted", "expired")]
        rank = {"done": 0, "processing": 1}  # closest to finished first, then the oldest (front of the queue)
        live.sort(key=lambda t: (rank.get(str(t.get("status")), 2), str(t.get("created", ""))))
        return live[0].get("task_id") if live else None

    def _status(self, task_id: str) -> str:
        return str(self._request("GET", f"/task/{task_id}").json().get("status", "unknown"))

    def _wait_done(self, task_id: str, wait: float) -> None:
        deadline = time.monotonic() + wait
        while True:
            try:
                status = self._status(task_id)
            except Unreachable:
                status = "unreachable"  # a blip: the task is still there, keep waiting
            if status == "done":
                return
            if status in ("error", "deleted", "expired"):
                raise TaskFailed(f"NASA AppEEARS could not prepare this area (task {status}). Please try again.")
            if time.monotonic() + self._poll > deadline:
                raise TaskPending(
                    f"NASA AppEEARS is preparing this area (status: {status}); it usually takes 2–10 minutes. "
                    "Run the analysis again in a few minutes."
                )
            time.sleep(self._poll)

    def _download_statistics(self, task_id: str, product: str, layer: str) -> pd.Series:
        files = self._request("GET", f"/bundle/{task_id}").json().get("files", [])
        entry = statistics_file(files, product)
        if entry is None:
            log.warning("AppEEARS bundle %s has no statistics CSV: %s", task_id, [f.get("file_name") for f in files][:20])
            raise ProviderError("NASA AppEEARS finished, but its result has no area statistics.")
        text = self._request("GET", f"/bundle/{task_id}/{entry['file_id']}", follow_redirects=True).text
        series = parse_statistics(text, layer)
        if series.empty:
            raise ProviderError("NASA AppEEARS returned no valid values for this area.")
        return series

    # -- cache ------------------------------------------------------------------------------------------

    def _key_lock(self, key: str) -> threading.Lock:
        with self._lock:
            return self._key_locks.setdefault(key, threading.Lock())

    def _path(self, key: str) -> Path:
        return self._cache_dir / f"{key.replace('.', '-')}.json"

    def _read_state(self, key: str) -> dict[str, Any]:
        path = self._path(key)
        try:
            return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        except (OSError, ValueError):
            return {}

    def _write_state(self, key: str, state: dict[str, Any]) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(f".tmp{os.getpid()}")
        tmp.write_text(json.dumps(state), encoding="utf-8")
        tmp.replace(path)


@register_provider("appeears")
def _factory(settings: Settings) -> AppeearsProvider:
    return AppeearsProvider(settings)
