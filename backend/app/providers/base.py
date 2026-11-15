"""The DataProvider interface and a name -> factory registry.

A provider turns (variable, bbox, start, end) into a **monthly, area-mean** ``pd.Series``:
float values indexed by a month-start ``DatetimeIndex``, NaN for missing months, in the variable's
catalog units. Everything downstream (preprocess, trends, API) is provider-agnostic.

Aggregation is the provider's job: daily products (GLDAS_CLSM025_DA1_D, OMNO2d) and 8-day composites
must be averaged to calendar months (``processing.timeseries.to_monthly``) and over the bbox
(``processing.timeseries.area_mean``) before returning. Variables with ``coverage == "series"`` are one
ready-made record (Mauna Loa CO₂, NOAA CH₄): they receive ``bbox=None``.

To add a provider: implement the protocol, decorate a factory with ``@register_provider("name")``,
import the module in ``app/providers/__init__.py`` and map the catalog ``access`` value to it in ``live.py``.
"""

from __future__ import annotations

import datetime as dt
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol, runtime_checkable

import pandas as pd

from app.catalog.models import CatalogVariable
from app.config import Settings
from app.schemas.common import BBox


class ProviderError(Exception):
    """A failure with a message that is safe and useful to show to the user."""


@runtime_checkable
class DataProvider(Protocol):
    name: str
    """Reported as ``AnalysisResult.provider`` and in ``/api/health``."""

    def fetch(self, variable: CatalogVariable, bbox: BBox | None, start: dt.date, end: dt.date) -> pd.Series:
        """Return the monthly area-mean series for ``start..end`` (inclusive, month-start index)."""
        ...


@dataclass(frozen=True)
class Route:
    """Which provider serves one variable."""

    provider: DataProvider


def route_for(provider: DataProvider, variable: CatalogVariable) -> Route:
    """Resolve a (possibly routing) provider to the concrete provider for ``variable``."""
    route = getattr(provider, "route", None)
    return route(variable) if callable(route) else Route(provider)


ProviderFactory = Callable[[Settings], DataProvider]

_REGISTRY: dict[str, ProviderFactory] = {}


def register_provider(name: str) -> Callable[[ProviderFactory], ProviderFactory]:
    """Decorator: register a factory that builds a provider from Settings."""

    def decorator(factory: ProviderFactory) -> ProviderFactory:
        _REGISTRY[name] = factory
        return factory

    return decorator


def create_provider(name: str, settings: Settings) -> DataProvider:
    try:
        factory = _REGISTRY[name]
    except KeyError:
        known = ", ".join(sorted(_REGISTRY)) or "none"
        raise ValueError(f"Unknown data provider {name!r} (registered: {known})") from None
    return factory(settings)


def registered_providers() -> list[str]:
    return sorted(_REGISTRY)
