"""NASA Giovanni / Earthdata provider — STUB, not wired yet.

This shows where real NASA data plugs in. It must return exactly what the synthetic provider returns:
a monthly, area-mean ``pd.Series`` (month-start ``DatetimeIndex``, float, NaN for missing months) in the
catalog units of the variable. Nothing else in the backend needs to change.

Two realistic routes (pick one; both need a free NASA Earthdata Login account):

1. **Giovanni area-averaged time series** (simplest, server does the spatial averaging)
   - Giovanni's "Time Series, Area-Averaged" service (``service=ArAvTs``) takes a data id, bbox and
     time range. Our catalog ``product`` field is ``"<ShortName>.<version>:<Variable>"``, which maps to a
     Giovanni data id such as ``M2TMNXSLV_5_12_4_T2M``.
   - Giovanni also exposes a programmatic time-series API (``api.giovanni.earthdata.nasa.gov``) that
     returns CSV and is authorised with an Earthdata bearer token.
   - TODO: confirm the current endpoint + parameters in the Giovanni API docs, then
     ``httpx.get(...)`` -> parse the CSV (header lines, then ``time,value``) with ``pandas.read_csv``.

2. **GES DISC OPeNDAP subsetting** (more control, we average ourselves)
   - Each monthly granule is reachable via OPeNDAP (e.g. MERRA-2 monthly files on
     ``goldsmr4.gesdisc.eosdis.nasa.gov/opendap/MERRA2_MONTHLY/...``). Request only the variable and the
     lat/lon index ranges covering the bbox (constraint expression), for each month in range.
   - Build a ``(time, lat, lon)`` numpy cube, apply the fill-value mask, then use
     ``app.processing.timeseries.area_mean(cube, lats)`` and ``to_monthly`` for daily products (OMI).
   - Use CMR (``cmr.earthdata.nasa.gov/search/granules.json?short_name=...&temporal=...``) to list
     granule URLs instead of hard-coding paths.

Either way:
- TODO: read ``TD_EARTHDATA_TOKEN`` (add it to ``Settings``) and send ``Authorization: Bearer <token>``.
- TODO: convert units to the catalog units (e.g. K -> °C for T2M/LST/SST, kg m⁻² s⁻¹ -> mm/day for
  evapotranspiration, mm/hr -> mm/day for IMERG, molecules/cm² -> 10¹⁵ molecules/cm² for NO₂).
- TODO: cache responses on disk (``backend/data/cache/`` is already git-ignored), keyed by
  (product, bbox, start, end): these calls can take tens of seconds.
- TODO: raise ``ProviderError("...")`` with a student-readable message on HTTP/auth/empty-data errors;
  the job runner shows it in ``Job.message``.
- Set ``local = False`` so the job runner does not add an artificial delay.
"""

from __future__ import annotations

import datetime as dt

import pandas as pd

from app.catalog.models import CatalogVariable
from app.config import Settings
from app.providers.base import ProviderError, register_provider
from app.schemas.common import BBox


class GiovanniProvider:
    """Real NASA data via Giovanni / OPeNDAP. Not implemented yet — see module docstring."""

    name = "giovanni"
    synthetic = False
    local = False

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def fetch(self, variable: CatalogVariable, bbox: BBox | None, start: dt.date, end: dt.date) -> pd.Series:
        # TODO: implement route 1 or 2 from the module docstring and return a monthly area-mean series.
        raise ProviderError(
            "Live NASA data is not connected yet. Set TD_DATA_PROVIDER=synthetic to use demo data."
        )


@register_provider("giovanni")
def _factory(settings: Settings) -> GiovanniProvider:
    return GiovanniProvider(settings)
