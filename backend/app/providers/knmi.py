"""KNMI Climate Explorer provider (ready-made greenhouse-gas records) — STUB, not wired yet.

NOTE: the three records below are now served with real data straight from NOAA GML by
``app/providers/noaa_gml.py`` (catalog ``access: NOAA GML``). This stub is kept as an alternative
mirror; nothing routes to it unless a catalog entry says ``access: KNMI Climate Explorer``.

Serves catalog variables with ``access: KNMI Climate Explorer``. These have ``coverage: "series"``: one
global / station record, so ``bbox`` is always ``None`` here (the job runner drops it).

=================  ======================  ================================================  =====
catalog id         product                 record                                            units
=================  ======================  ================================================  =====
mauna_loa_co2      NOAA-GML:co2_mm_mlo     Mauna Loa monthly CO₂ (NOAA/Scripps), 1958-03 ->  ppm
noaa_co2_marine    NOAA-GML:co2_mm_gl      NOAA global marine surface CO₂, 1980 ->           ppm
noaa_ch4_marine    NOAA-GML:ch4_mm_gl      NOAA global marine surface CH₄, 1983-07 ->        ppb
=================  ======================  ================================================  =====

Route
-----
- KNMI Climate Explorer (https://climexp.knmi.nl, "Monthly climate indices" -> "Atmospheric
  composition") serves each record as a plain-text ``.dat`` file: ``#`` comment lines, then one row per
  year: ``year v_jan v_feb ... v_dec`` with ``-999.9`` (or similar) for missing months.
  TODO: look up the exact file names of the three series on Climate Explorer (e.g. via the "raw data"
  link on each series page) and put them in a dict keyed by catalog id.
- Parse: skip ``#`` lines, ``pandas.read_csv(sep=r"\\s+", header=None)``, melt the 12 month columns into a
  month-start ``DatetimeIndex``, replace the missing-value marker with NaN.
- Fallback with identical content: NOAA GML text files ``https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_mlo.txt``,
  ``.../co2/co2_mm_gl.txt`` and ``.../ch4/ch4_mm_gl.txt`` (columns: year, month, decimal date, average, ...).
- No authentication. TODO: cache the downloaded file for a day in ``backend/data/cache/``.
- Return ``series.loc[start:end]`` (monthly, NaN for missing months, catalog units already).
"""

from __future__ import annotations

import datetime as dt

import pandas as pd

from app.catalog.models import CatalogVariable
from app.config import Settings
from app.providers.base import ProviderError, register_provider
from app.schemas.common import BBox


class KNMIProvider:
    """Single-series records from KNMI Climate Explorer. Not implemented yet — see module docstring."""

    name = "knmi"
    synthetic = False
    local = False

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def fetch(self, variable: CatalogVariable, bbox: BBox | None, start: dt.date, end: dt.date) -> pd.Series:
        # TODO: download + parse the KNMI .dat file (see module docstring); bbox is ignored.
        raise ProviderError(
            f"Live data for {variable.name} from KNMI Climate Explorer is not connected yet. "
            "Set TD_DATA_PROVIDER=synthetic to use demo data."
        )


@register_provider("knmi")
def _factory(settings: Settings) -> KNMIProvider:
    return KNMIProvider(settings)
