"""The ``live`` provider: route each catalog variable to its real data source by its ``access`` field.

=====================  ==============  ==========================================================
``access``             provider        source
=====================  ==============  ==========================================================
Giovanni / GES DISC    ``earthdata``   GLDAS, GPM IMERG, OMI NO₂, MERRA-2 via GES DISC OPeNDAP
AppEEARS               ``appeears``    MODIS land surface temperature and NDVI (AppEEARS area tasks)
LAADS                  ``blackmarble`` VIIRS Black Marble nighttime lights via LAADS OPeNDAP
NOAA GML               ``noaa_gml``    CO₂ / CH₄ monthly records
=====================  ==============  ==========================================================

There is no demo or synthetic data: when a source fails, the analysis fails with the provider's
student-readable message. To add a source: implement a provider, register it and map its ``access`` here.
"""

from __future__ import annotations

import datetime as dt

import pandas as pd

from app.catalog.models import CatalogVariable
from app.config import Settings
from app.providers.base import DataProvider, ProviderError, Route, create_provider, register_provider
from app.schemas.common import BBox

ACCESS_TO_PROVIDER = {
    "giovanni": "earthdata",
    "ges disc opendap": "earthdata",
    "appeears": "appeears",
    "laads": "blackmarble",
    "noaa gml": "noaa_gml",
}


def provider_key(variable: CatalogVariable) -> str | None:
    return ACCESS_TO_PROVIDER.get(variable.access.strip().lower())


class LiveProvider:
    name = "live"

    def __init__(self, settings: Settings) -> None:
        self._providers: dict[str, DataProvider] = {
            name: create_provider(name, settings) for name in set(ACCESS_TO_PROVIDER.values())
        }

    def provider_for(self, variable: CatalogVariable) -> DataProvider:
        key = provider_key(variable)
        if key is None:
            raise ProviderError(f"No data source is set up for {variable.name} (access: {variable.access}).")
        return self._providers[key]

    def route(self, variable: CatalogVariable) -> Route:
        key = provider_key(variable)
        return Route(self._providers[key]) if key is not None else Route(self)  # unknown: fetch() explains

    def fetch(self, variable: CatalogVariable, bbox: BBox | None, start: dt.date, end: dt.date) -> pd.Series:
        return self.provider_for(variable).fetch(variable, bbox, start, end)


@register_provider("live")
def _live_factory(settings: Settings) -> LiveProvider:
    return LiveProvider(settings)
