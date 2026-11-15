"""Place search for the map: proxy to Photon (komoot), falling back to OSM Nominatim.

Both are free public services with usage policies: we send a generic User-Agent (no personal data), cache
answers in memory, time out after a few seconds and keep at most one request per second to Nominatim.
"""

from __future__ import annotations

import logging
import threading
import time
from collections import OrderedDict

import httpx

from app.config import Settings
from app.schemas import BBox, Place
from app.schemas.common import MIN_BBOX_SPAN_DEG

log = logging.getLogger(__name__)

USER_AGENT = "TrendDetective/0.1 (hackathon demo)"


class GeocodeError(RuntimeError):
    """Every upstream failed: the API answers 502 with this message."""


def _place_bbox(west: float, south: float, east: float, north: float) -> BBox | None:
    """A valid BBox from an upstream extent; tiny extents are padded, antimeridian-crossing ones dropped."""
    if west > east:  # crosses the 180° line (e.g. Fiji): v1 bboxes cannot express that
        return None
    west, east = max(-180.0, west), min(180.0, east)
    south, north = max(-90.0, min(south, north)), min(90.0, max(south, north))
    pad = MIN_BBOX_SPAN_DEG * 0.6  # a bit over half, so float rounding never lands below the minimum
    if east - west < MIN_BBOX_SPAN_DEG:
        c = (west + east) / 2
        west, east = max(-180.0, c - pad), min(180.0, c + pad)
    if north - south < MIN_BBOX_SPAN_DEG:
        c = (south + north) / 2
        south, north = max(-90.0, c - pad), min(90.0, c + pad)
    try:
        return BBox(west=west, south=south, east=east, north=north)
    except ValueError:
        return None


def _join_unique(parts: list[str | None]) -> str:
    seen: list[str] = []
    for p in parts:
        if p and p not in seen:
            seen.append(p)
    return ", ".join(seen)


def places_from_photon(data: dict) -> list[Place]:
    """Photon GeoJSON FeatureCollection -> Place[] (``extent`` is [west, north, east, south])."""
    places = []
    for feature in data.get("features") or []:
        props = feature.get("properties") or {}
        coords = (feature.get("geometry") or {}).get("coordinates") or []
        if len(coords) < 2:
            continue
        lon, lat = float(coords[0]), float(coords[1])
        name = props.get("name") or props.get("city") or props.get("state") or props.get("country")
        if not name:
            continue
        extent = props.get("extent")
        bbox = _place_bbox(extent[0], extent[3], extent[2], extent[1]) if extent and len(extent) == 4 else None
        display = _join_unique([name, props.get("city"), props.get("county"), props.get("state"), props.get("country")])
        places.append(Place(
            name=name, display_name=display, lat=lat, lon=lon, bbox=bbox,
            kind=next((k for k in (props.get("type"), props.get("osm_value")) if k and k != "other"), "place"),
        ))
    return places


def places_from_nominatim(data: list) -> list[Place]:
    """Nominatim jsonv2 list -> Place[] (``boundingbox`` is [south, north, west, east] as strings)."""
    places = []
    for item in data or []:
        try:
            lat, lon = float(item["lat"]), float(item["lon"])
        except (KeyError, TypeError, ValueError):
            continue
        display = item.get("display_name") or ""
        name = item.get("name") or display.split(",")[0].strip()
        if not name:
            continue
        bb = item.get("boundingbox")
        bbox = None
        if bb and len(bb) == 4:
            south, north, west, east = (float(x) for x in bb)
            bbox = _place_bbox(west, south, east, north)
        places.append(Place(
            name=name, display_name=display or name, lat=lat, lon=lon, bbox=bbox,
            kind=item.get("addresstype") or item.get("type") or item.get("category") or "place",
        ))
    return places


class Geocoder:
    """Photon first, Nominatim as fallback; TTL-cached. ``transport`` lets tests mock HTTP."""

    def __init__(self, settings: Settings, transport: httpx.BaseTransport | None = None) -> None:
        self.photon_url = settings.photon_url
        self.nominatim_url = settings.nominatim_url
        self.ttl = settings.geocode_cache_ttl
        self.min_interval = settings.nominatim_min_interval
        self.client = httpx.Client(
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            timeout=settings.geocode_timeout,
            transport=transport,
            follow_redirects=True,
        )
        self._cache: OrderedDict[tuple[str, int], tuple[float, list[Place]]] = OrderedDict()
        self._cache_lock = threading.Lock()
        self._nominatim_lock = threading.Lock()
        self._nominatim_last = 0.0
        self.max_entries = 1000

    def search(self, query: str, limit: int = 6) -> list[Place]:
        key = (" ".join(query.split()).casefold(), limit)
        now = time.monotonic()
        with self._cache_lock:
            hit = self._cache.get(key)
            if hit and hit[0] > now:
                self._cache.move_to_end(key)
                return hit[1]
        places = self._lookup(query.strip(), limit)
        with self._cache_lock:
            self._cache[key] = (now + self.ttl, places)
            self._cache.move_to_end(key)
            while len(self._cache) > self.max_entries:
                self._cache.popitem(last=False)
        return places

    def _lookup(self, query: str, limit: int) -> list[Place]:
        errors = []
        try:
            places = self._photon(query, limit)
            if places:
                return places
        except (httpx.HTTPError, ValueError) as exc:
            log.warning("Photon geocoding failed: %s", exc)
            errors.append(f"Photon: {_describe(exc)}")
        try:
            return self._nominatim(query, limit)
        except (httpx.HTTPError, ValueError) as exc:
            log.warning("Nominatim geocoding failed: %s", exc)
            errors.append(f"Nominatim: {_describe(exc)}")
        raise GeocodeError("Place search is unavailable right now (" + "; ".join(errors) + "). Try again later.")

    def _photon(self, query: str, limit: int) -> list[Place]:
        r = self.client.get(self.photon_url, params={"q": query, "limit": limit, "lang": "en"})
        r.raise_for_status()
        return places_from_photon(r.json())[:limit]

    def _nominatim(self, query: str, limit: int) -> list[Place]:
        with self._nominatim_lock:  # usage policy: at most 1 request per second
            wait = self._nominatim_last + self.min_interval - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            try:
                r = self.client.get(self.nominatim_url, params={"format": "jsonv2", "q": query, "limit": limit, "accept-language": "en"})
            finally:
                self._nominatim_last = time.monotonic()
        r.raise_for_status()
        return places_from_nominatim(r.json())[:limit]

    def close(self) -> None:
        self.client.close()


def _describe(exc: Exception) -> str:
    if isinstance(exc, httpx.TimeoutException):
        return "timed out"
    if isinstance(exc, httpx.HTTPStatusError):
        return f"HTTP {exc.response.status_code}"
    if isinstance(exc, httpx.HTTPError):
        return "could not connect"
    return "unexpected response"
