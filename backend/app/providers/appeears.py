"""NASA AppEEARS provider (MODIS land surface temperature) — STUB, not wired yet.

Serves catalog variables with ``access: AppEEARS``:

=================  ==========================  ========================  ===========================
catalog id         product                     AppEEARS layer            native units -> catalog
=================  ==========================  ========================  ===========================
modis_lst_day      MOD11C3.061:LST_Day_CMG     MOD11C3.061 / LST_Day_CMG   K -> °C (value - 273.15)
modis_lst_night    MOD11C3.061:LST_Night_CMG   MOD11C3.061 / LST_Night_CMG K -> °C (value - 273.15)
=================  ==========================  ========================  ===========================

MOD11C3 is monthly on a 0.05° climate-modeling grid, from 2000-03. For single cities the team may prefer
MOD11A2 (8-day, 1 km): average the 8-day composites to calendar months with
``processing.timeseries.to_monthly`` before returning. AppEEARS already applies the 0.02 scale factor
when asked for scaled output; the Kelvin -> °C step is ``variable.to_catalog_units(values)``.

Route (AppEEARS API, https://appeears.earthdatacloud.nasa.gov/api/)
-------------------------------------------------------------------
1. ``POST /login`` with Earthdata username/password (basic auth) -> bearer token.
   TODO: add ``TD_EARTHDATA_USER`` / ``TD_EARTHDATA_PASSWORD`` (or a token) to ``Settings``.
2. ``POST /task`` with an **area** request: ``{"task_type": "area", "params": {"dates": [{"startDate":
   "MM-DD-YYYY", "endDate": ...}], "layers": [{"product": "MOD11C3.061", "layer": "LST_Night_CMG"}],
   "geo": <GeoJSON polygon of the bbox>, "output": {"format": {"type": "netcdf4"}, "projection": "geographic"}}}``.
3. Poll ``GET /status/{task_id}`` until done (minutes, not seconds!), then ``GET /bundle/{task_id}`` and
   download the NetCDF; mask fill values / QC, cos-lat weighted mean with
   ``processing.timeseries.area_mean`` -> monthly series.
   AppEEARS also returns a per-task ``*-Statistics.csv`` with the area mean per date, which may be enough.

TODO: because tasks are slow, cache finished bundles on disk (``backend/data/cache/``) keyed by
(product, layer, bbox) and request the full availability window once, then slice by date.
TODO: raise ``ProviderError`` with a student-readable message on auth/timeout/empty results.
"""

from __future__ import annotations

import datetime as dt

import pandas as pd

from app.catalog.models import CatalogVariable
from app.config import Settings
from app.providers.base import ProviderError, register_provider
from app.schemas.common import BBox


class AppEEARSProvider:
    """MODIS LST via AppEEARS. Not implemented yet — see module docstring."""

    name = "appeears"
    synthetic = False
    local = False

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def fetch(self, variable: CatalogVariable, bbox: BBox | None, start: dt.date, end: dt.date) -> pd.Series:
        # TODO: login -> submit area task -> poll -> download -> area mean -> to_monthly -> to_catalog_units.
        raise ProviderError(
            f"Live AppEEARS data for {variable.name} is not connected yet. "
            "Set TD_DATA_PROVIDER=synthetic to use demo data."
        )


@register_provider("appeears")
def _factory(settings: Settings) -> AppEEARSProvider:
    return AppEEARSProvider(settings)
