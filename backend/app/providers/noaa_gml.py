"""NOAA Global Monitoring Laboratory provider: real monthly greenhouse-gas records (no auth).

Serves the catalog variables whose ``product`` is ``NOAA-GML:<file>`` (all ``coverage: "series"``, so
``bbox`` is ignored). The file is ``{TD_NOAA_GML_BASE_URL}/<gas>/<file>.txt``, ``<gas>`` being the
file-name prefix:

=================  ===========================================================================
catalog id         source file
=================  ===========================================================================
mauna_loa_co2      https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_mlo.txt  (1958-03 ->)
noaa_co2_marine    https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_gl.txt   (1979-01 ->)
noaa_ch4_marine    https://gml.noaa.gov/webdata/ccgg/trends/ch4/ch4_mm_gl.txt   (1983-07 ->)
=================  ===========================================================================

Format (all three): ``#`` comment lines, then whitespace-separated rows
``year month decimal_date average ...``. We use column 4, the monthly mean ("average" / "monthly
average"); values <= -9 (``-9.99``, ``-99.99`` markers) are missing. Mauna Loa months that NOAA
interpolated are flagged only in the st.dev column, so they are kept like NOAA's own plots do.

Downloads go through httpx (``TD_HTTP_TIMEOUT``) and the raw text is cached in
``TD_CACHE_DIR/noaa_gml/<file>.txt`` for ``TD_NOAA_CACHE_TTL_DAYS``. When the download fails a stale
cached copy is used; with no copy at all a :class:`ProviderError` is raised (the ``auto`` provider then
falls back to synthetic data with :data:`FALLBACK_WARNING`).
"""

from __future__ import annotations

import datetime as dt
import io
import logging
import os
import threading
import time
from pathlib import Path

import httpx
import numpy as np
import pandas as pd

from app.catalog.models import CatalogVariable
from app.config import Settings
from app.providers.base import ProviderError, register_provider
from app.schemas.common import BBox

log = logging.getLogger(__name__)

PRODUCT_PREFIX = "NOAA-GML:"
MISSING_BELOW = -9.0
"""Monthly means at or below this are NOAA missing-value markers (-9.99, -99.99)."""
FALLBACK_WARNING = "Couldn't reach NOAA; showing demo data."


def file_name(variable: CatalogVariable) -> str:
    """``NOAA-GML:co2_mm_mlo`` -> ``co2_mm_mlo``."""
    if not variable.product.startswith(PRODUCT_PREFIX):
        raise ProviderError(f"{variable.name} is not a NOAA GML record.")
    return variable.product[len(PRODUCT_PREFIX):]


def file_url(base_url: str, name: str) -> str:
    gas = name.split("_", 1)[0]
    return f"{base_url.rstrip('/')}/{gas}/{name}.txt"


def parse_monthly(text: str) -> pd.Series:
    """Parse a NOAA GML ``*_mm_*.txt`` file into a complete monthly (month-start) series, NaN = missing."""
    try:
        table = pd.read_csv(io.StringIO(text), comment="#", sep=r"\s+", header=None, usecols=[0, 1, 3])
    except (ValueError, pd.errors.ParserError) as exc:
        raise ProviderError("NOAA sent data in an unexpected format.") from exc
    if table.empty:
        raise ProviderError("NOAA sent an empty data file.")
    table.columns = ["year", "month", "value"]
    try:
        index = pd.to_datetime(dict(year=table["year"], month=table["month"], day=1))
        values = pd.to_numeric(table["value"]).astype(float)
    except (ValueError, TypeError) as exc:
        raise ProviderError("NOAA sent data in an unexpected format.") from exc
    series = pd.Series(values.to_numpy(), index=pd.DatetimeIndex(index))
    series[series <= MISSING_BELOW] = np.nan
    series = series[~series.index.duplicated(keep="last")].sort_index()
    return series.asfreq("MS")


class NoaaGmlProvider:
    """Real monthly NOAA GML records, downloaded once and cached on disk."""

    name = "noaa_gml"
    synthetic = False
    local = False
    fallback_warning = FALLBACK_WARNING

    def __init__(self, settings: Settings) -> None:
        self._base_url = settings.noaa_gml_base_url
        self._cache_dir = Path(settings.cache_dir) / "noaa_gml"
        self._ttl = settings.noaa_cache_ttl_days * 86400
        self._timeout = settings.http_timeout
        self._lock = threading.Lock()
        self._parsed: dict[str, tuple[float, pd.Series]] = {}  # file name -> (cache mtime, series)

    def cache_path(self, name: str) -> Path:
        return self._cache_dir / f"{name}.txt"

    def fetch(self, variable: CatalogVariable, bbox: BBox | None, start: dt.date, end: dt.date) -> pd.Series:
        series = self.load(file_name(variable)).rename(variable.id)
        return series.loc[pd.Timestamp(start).replace(day=1):pd.Timestamp(end)]

    def load(self, name: str) -> pd.Series:
        """The full record for one file, from the disk cache (refreshed when older than the TTL)."""
        with self._lock:
            path = self._ensure_cached(name)
            mtime = path.stat().st_mtime
            hit = self._parsed.get(name)
            if hit is None or hit[0] != mtime:
                hit = (mtime, parse_monthly(path.read_text(encoding="utf-8")))
                self._parsed[name] = hit
            return hit[1]

    def refresh(self, name: str) -> Path:
        """Download ``name`` now (ignoring the TTL) and store it in the cache."""
        with self._lock:
            return self._download(name)

    def _ensure_cached(self, name: str) -> Path:
        path = self.cache_path(name)
        if path.exists() and time.time() - path.stat().st_mtime < self._ttl:
            return path
        try:
            return self._download(name)
        except ProviderError:
            if path.exists():
                log.warning("Using stale NOAA GML cache %s (download failed)", path)
                return path
            raise

    def _download(self, name: str) -> Path:
        url = file_url(self._base_url, name)
        try:
            response = httpx.get(url, timeout=self._timeout, follow_redirects=True)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            log.warning("NOAA GML download failed for %s: %s", url, exc)
            raise ProviderError("Couldn't reach NOAA to download the data. Please try again later.") from exc
        text = response.text
        parse_monthly(text)  # never cache a broken file
        path = self.cache_path(name)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(f".tmp{os.getpid()}")
        tmp.write_text(text, encoding="utf-8")
        tmp.replace(path)
        log.info("Cached NOAA GML %s (%d bytes)", url, len(text))
        return path


@register_provider("noaa_gml")
def _factory(settings: Settings) -> NoaaGmlProvider:
    return NoaaGmlProvider(settings)


def prefetch(settings: Settings | None = None) -> list[Path]:
    """Download every NOAA GML file used by the catalog into the cache (for offline demos)."""
    from app.catalog import Catalog
    from app.config import get_settings

    provider = NoaaGmlProvider(settings or get_settings())
    names = sorted({file_name(v) for v in Catalog.from_dir().variables() if v.product.startswith(PRODUCT_PREFIX)})
    return [provider.refresh(name) for name in names]

