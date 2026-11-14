"""Routing providers: pick the data provider for each catalog variable from its ``access`` field.

- ``TD_DATA_PROVIDER=auto`` (default): real data where a provider is implemented
  (:data:`IMPLEMENTED`: today the NOAA GML greenhouse-gas records), synthetic for everything else.
  If a real download fails with no cached copy, the result falls back to synthetic data and carries
  the provider's ``fallback_warning`` ("Couldn't reach NOAA; showing demo data.").
- ``TD_DATA_PROVIDER=live``: real providers only, no fallback. Giovanni / GES DISC products go to
  ``giovanni``, MODIS LST to ``appeears`` (both stubs that raise "not connected yet").
- ``TD_DATA_PROVIDER=synthetic``: demo data for everything (no routing).

To switch a variable group to real data: implement its provider, map its ``access`` value here and
add the provider name to :data:`IMPLEMENTED`.
"""

from __future__ import annotations

import datetime as dt

import pandas as pd

from app.catalog.models import CatalogVariable
from app.config import Settings
from app.providers.base import DataProvider, ProviderError, Route, create_provider, register_provider
from app.schemas.common import BBox

ACCESS_TO_PROVIDER = {
    "giovanni": "giovanni",
    "ges disc opendap": "giovanni",
    "appeears": "appeears",
    "noaa gml": "noaa_gml",
    "knmi climate explorer": "knmi",  # stub kept; the NOAA GML files are used directly instead
}
IMPLEMENTED = frozenset({"noaa_gml"})
"""Providers that return real data; ``auto`` uses only these and synthetic data for the rest."""


def _provider_key(variable: CatalogVariable) -> str | None:
    return ACCESS_TO_PROVIDER.get(variable.access.strip().lower())


def _fetch(route: Route, variable: CatalogVariable, bbox: BBox | None, start: dt.date, end: dt.date) -> pd.Series:
    try:
        return route.provider.fetch(variable, bbox, start, end)
    except ProviderError:
        if route.fallback is None:
            raise
        return route.fallback.fetch(variable, bbox, start, end)


class LiveProvider:
    name = "live"
    synthetic = False
    local = False

    def __init__(self, settings: Settings) -> None:
        self._providers: dict[str, DataProvider] = {
            name: create_provider(name, settings) for name in set(ACCESS_TO_PROVIDER.values())
        }

    def provider_for(self, variable: CatalogVariable) -> DataProvider:
        key = _provider_key(variable)
        if key is None:
            raise ProviderError(f"No live data source is set up for {variable.name} (access: {variable.access}).")
        return self._providers[key]

    def route(self, variable: CatalogVariable) -> Route:
        key = _provider_key(variable)
        return Route(self._providers[key]) if key is not None else Route(self)  # unknown: fetch() explains

    def fetch(self, variable: CatalogVariable, bbox: BBox | None, start: dt.date, end: dt.date) -> pd.Series:
        return self.provider_for(variable).fetch(variable, bbox, start, end)


class AutoProvider:
    """Real data where implemented, synthetic elsewhere and as the fallback when real data is unreachable."""

    name = "auto"
    synthetic = False
    local = False

    def __init__(self, settings: Settings) -> None:
        self._synthetic = create_provider("synthetic", settings)
        self._real: dict[str, DataProvider] = {name: create_provider(name, settings) for name in IMPLEMENTED}

    def route(self, variable: CatalogVariable) -> Route:
        real = self._real.get(_provider_key(variable) or "")
        if real is None:
            return Route(self._synthetic)
        warning = getattr(real, "fallback_warning", None) or "Couldn't reach the data source; showing demo data."
        return Route(real, fallback=self._synthetic, fallback_warning=warning)

    def fetch(self, variable: CatalogVariable, bbox: BBox | None, start: dt.date, end: dt.date) -> pd.Series:
        return _fetch(self.route(variable), variable, bbox, start, end)


@register_provider("live")
def _live_factory(settings: Settings) -> LiveProvider:
    return LiveProvider(settings)


@register_provider("auto")
def _auto_factory(settings: Settings) -> AutoProvider:
    return AutoProvider(settings)
