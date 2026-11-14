"""Routes each catalog variable to the real-data provider named by its ``access`` field.

``TD_DATA_PROVIDER=live`` serves Giovanni / GES DISC products via ``giovanni``, MODIS LST via
``appeears`` and the ready-made greenhouse-gas records via ``knmi``. Each of those is a stub today, so
this mostly shows where things plug in; implementing one provider makes its variables work.
"""

from __future__ import annotations

import datetime as dt

import pandas as pd

from app.catalog.models import CatalogVariable
from app.config import Settings
from app.providers.base import DataProvider, ProviderError, create_provider, register_provider
from app.schemas.common import BBox

ACCESS_TO_PROVIDER = {
    "giovanni": "giovanni",
    "ges disc opendap": "giovanni",
    "appeears": "appeears",
    "knmi climate explorer": "knmi",
}


class LiveProvider:
    name = "live"
    synthetic = False
    local = False

    def __init__(self, settings: Settings) -> None:
        self._providers: dict[str, DataProvider] = {
            name: create_provider(name, settings) for name in set(ACCESS_TO_PROVIDER.values())
        }

    def provider_for(self, variable: CatalogVariable) -> DataProvider:
        key = ACCESS_TO_PROVIDER.get(variable.access.strip().lower())
        if key is None:
            raise ProviderError(f"No live data source is set up for {variable.name} (access: {variable.access}).")
        return self._providers[key]

    def fetch(self, variable: CatalogVariable, bbox: BBox | None, start: dt.date, end: dt.date) -> pd.Series:
        return self.provider_for(variable).fetch(variable, bbox, start, end)


@register_provider("live")
def _factory(settings: Settings) -> LiveProvider:
    return LiveProvider(settings)
