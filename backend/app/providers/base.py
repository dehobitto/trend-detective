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
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Protocol, runtime_checkable

import pandas as pd

from app.catalog.models import CatalogVariable
from app.config import Settings
from app.schemas.common import BBox


ProgressCallback = Callable[[int, int], None]
"""``(done, total)`` download steps; called by providers while ``fetch`` runs."""

_progress: ContextVar[ProgressCallback | None] = ContextVar("fetch_progress", default=None)


@contextmanager
def fetch_progress(callback: ProgressCallback) -> Iterator[None]:
    """Route ``report_progress`` calls made during ``fetch`` (same thread) to ``callback``."""
    token = _progress.set(callback)
    try:
        yield
    finally:
        _progress.reset(token)


_mask: ContextVar["tuple[BBox, ...] | None"] = ContextVar("fetch_mask", default=None)


@contextmanager
def fetch_mask(cells: "list[BBox] | None") -> Iterator[None]:
    """Average only inside these squares during ``fetch`` (a named region approximated by grid squares).

    Providers read it with :func:`current_mask` in ``fetch`` itself (worker threads don't inherit context
    variables, so pass it on explicitly). ``None`` or empty = the whole bbox, as before.
    """
    token = _mask.set(tuple(cells) if cells else None)
    try:
        yield
    finally:
        _mask.reset(token)


def current_mask() -> "tuple[BBox, ...] | None":
    return _mask.get()


def mask_key(cells: "tuple[BBox, ...] | None") -> str:
    """Short stable id of a set of squares, for cache file names ('' without a mask)."""
    if not cells:
        return ""
    import hashlib

    text = ";".join(sorted(f"{c.west:.4f},{c.south:.4f},{c.east:.4f},{c.north:.4f}" for c in cells))
    return "_m" + hashlib.sha1(text.encode()).hexdigest()[:10]


def mask_grid(cells: "tuple[BBox, ...]", lats, lons):
    """Boolean ``(len(lats), len(lons))``: which grid-cell centres fall inside any square.

    If the squares are finer than the product grid and catch no centre at all, the cell nearest each
    square's centre is used instead, so a small region never ends up empty.
    """
    import numpy as np

    lat = np.asarray(lats)[:, None]
    lon = np.asarray(lons)[None, :]
    inside = np.zeros((lat.shape[0], lon.shape[1]), dtype=bool)
    for c in cells:
        inside |= (lat >= c.south) & (lat < c.north) & (lon >= c.west) & (lon < c.east)
    if not inside.any():
        for c in cells:
            i = int(np.argmin(np.abs(lat[:, 0] - (c.south + c.north) / 2)))
            j = int(np.argmin(np.abs(lon[0, :] - (c.west + c.east) / 2)))
            inside[i, j] = True
    return inside


def report_progress(done: int, total: int) -> None:
    """Providers call this as slow downloads advance. A no-op unless a job is listening."""
    callback = _progress.get()
    if callback is not None:
        callback(done, total)


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
