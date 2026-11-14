"""NASA Giovanni / GES DISC provider — STUB, not wired yet.

Serves every catalog variable with ``access: Giovanni`` (all GES DISC products in the team's list).
It must return exactly what the synthetic provider returns: a **monthly, area-mean** ``pd.Series``
(month-start ``DatetimeIndex``, float, NaN for missing months) in the catalog units of the variable.
Nothing else in the backend needs to change.

Products and variables (catalog ``product`` = ``"<ShortName>.<version>:<Variable>"``)
------------------------------------------------------------------------------------
- ``gldas_gws``  GLDAS_CLSM025_DA1_D.2.2:GWS_tavg   (daily, 0.25°, mm; no conversion)
- ``gldas_tws``  GLDAS_CLSM025_DA1_D.2.2:TWS_tavg   (daily, 0.25°, mm; no conversion)
- ``omi_no2``    OMNO2d.004:ColumnAmountNO2TropCloudScreened  (daily, 0.25°, molecules/cm² x 1e-15
  -> 10¹⁵ molecules/cm²)
- ``merra2_dust`` / ``merra2_bc`` / ``merra2_oc`` / ``merra2_so2`` / ``merra2_so4``
  M2TMNXAER.5.12.4:DUSMASS / BCSMASS / OCSMASS / SO2SMASS / SO4SMASS  (monthly, 0.5°x0.625°,
  kg/m³ x 1e9 -> µg/m³)
- ``merra2_aod`` / ``merra2_sulfate_aod``  M2TMNXAER.5.12.4:TOTEXTTAU / SUEXTTAU  (monthly, unitless)
- ``gpm_precipitation``  GPM_3IMERGM.07:precipitation  (monthly, 0.1°, mm/hr x 24 -> mm/day)

The conversion is stored in the catalog (``variable.conversion``); apply it with
``variable.to_catalog_units(values)`` rather than hard-coding it here.

**Daily products (GLDAS, OMNO2d) are aggregated here**: fetch the daily area means, then
``processing.timeseries.to_monthly`` (calendar-month mean) before returning. Months with very few valid
days (OMI cloud screening!) can be set to NaN; the pipeline interpolates short gaps and skips long ones.

Two realistic routes (both need a free NASA Earthdata Login account)
--------------------------------------------------------------------
1. **Giovanni area-averaged time series** (simplest, the server does the spatial averaging)
   - Giovanni's "Time Series, Area-Averaged" service (``service=ArAvTs``) takes a data id, bbox and time
     range. Giovanni data ids are ``<ShortName>_<version with _>_<Variable>``, e.g.
     ``GLDAS_CLSM025_DA1_D_2_2_GWS_tavg``, ``OMNO2d_004_ColumnAmountNO2TropCloudScreened``,
     ``M2TMNXAER_5_12_4_DUSMASS``, ``GPM_3IMERGM_07_precipitation``.
   - Giovanni also has a programmatic time-series API (``api.giovanni.earthdata.nasa.gov``) that returns
     CSV and is authorised with an Earthdata bearer token.
   - TODO: confirm the current endpoint + parameters (and the exact data ids, which Giovanni lists in its
     variable picker) in the Giovanni API docs, then ``httpx.get(...)`` -> parse the CSV (header lines,
     then ``time,value``) with ``pandas.read_csv``.

2. **GES DISC OPeNDAP subsetting** (more control, we average ourselves)
   - List granules with CMR: ``cmr.earthdata.nasa.gov/search/granules.json?short_name=GLDAS_CLSM025_DA1_D
     &version=2.2&temporal=...`` (same for ``OMNO2d``/``004``, ``M2TMNXAER``/``5.12.4``,
     ``GPM_3IMERGM``/``07``). Request only the variable and the lat/lon index ranges covering the bbox
     (OPeNDAP constraint expression) for each granule.
   - Build a ``(time, lat, lon)`` cube, apply the fill-value mask, then
     ``processing.timeseries.area_mean(cube, lats)``; for daily products also ``to_monthly``.
   - MERRA-2 monthly files live under ``goldsmr4.gesdisc.eosdis.nasa.gov/opendap/MERRA2_MONTHLY/M2TMNXAER.5.12.4/``;
     IMERG monthly under ``gpm1.gesdisc.eosdis.nasa.gov/opendap/GPM_L3/GPM_3IMERGM.07/``.

Either way:
- TODO: read ``TD_EARTHDATA_TOKEN`` (add it to ``Settings``) and send ``Authorization: Bearer <token>``.
- TODO: cache responses on disk (``backend/data/cache/`` is already git-ignored), keyed by
  (product, bbox, start, end): these calls can take tens of seconds.
- TODO: raise ``ProviderError("...")`` with a student-readable message on HTTP/auth/empty-data errors;
  the job runner shows it in ``Job.message``.
- ``local = False`` so the job runner does not add an artificial delay.
"""

from __future__ import annotations

import datetime as dt

import pandas as pd

from app.catalog.models import CatalogVariable
from app.config import Settings
from app.providers.base import ProviderError, register_provider
from app.schemas.common import BBox


def giovanni_data_id(product: str) -> str:
    """``"GLDAS_CLSM025_DA1_D.2.2:GWS_tavg"`` -> ``"GLDAS_CLSM025_DA1_D_2_2_GWS_tavg"`` (verify in Giovanni)."""
    short_and_version, variable = product.split(":", 1)
    return f"{short_and_version.replace('.', '_')}_{variable}"


class GiovanniProvider:
    """Real NASA data via Giovanni / GES DISC OPeNDAP. Not implemented yet — see module docstring."""

    name = "giovanni"
    synthetic = False
    local = False

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def fetch(self, variable: CatalogVariable, bbox: BBox | None, start: dt.date, end: dt.date) -> pd.Series:
        # TODO: implement route 1 or 2 from the module docstring:
        #   raw = <area-mean values in native units, daily or monthly>
        #   monthly = processing.timeseries.to_monthly(raw)      # daily products only
        #   return variable.to_catalog_units(monthly)
        raise ProviderError(
            f"Live NASA data for {variable.name} ({giovanni_data_id(variable.product)}) is not connected yet. "
            "Set TD_DATA_PROVIDER=synthetic to use demo data."
        )


@register_provider("giovanni")
def _factory(settings: Settings) -> GiovanniProvider:
    return GiovanniProvider(settings)
