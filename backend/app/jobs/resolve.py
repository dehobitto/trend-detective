"""Turn an AnalysisRequest into a concrete plan: which variable, which provider, which dates.

Used twice: by the API at submit time (so bad requests fail fast with 404/422) and by the job runner.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field

from app.catalog import Catalog, CatalogVariable
from app.processing.timeseries import infer_frequency
from app.providers import DataProvider, UploadProvider, dataset_variable, route_for
from app.schemas.analysis import AnalysisRequest
from app.schemas.common import BBox

MIN_YEARS = {"monthly": 2, "annual": 5}


class NotFound(LookupError):
    """Unknown variable or dataset (HTTP 404)."""


class InvalidRequest(ValueError):
    """Request is well-formed but cannot be analyzed (HTTP 422)."""


@dataclass
class Plan:
    variable: CatalogVariable
    provider: DataProvider
    start: dt.date
    end: dt.date
    aggregation: str
    bbox: BBox | None = None
    """The area passed to the provider: None for uploads and "series" variables (any request bbox is ignored)."""
    warnings: list[str] = field(default_factory=list)
    fallback: DataProvider | None = None
    """Used when ``provider`` raises ProviderError (e.g. NOAA unreachable -> synthetic)."""
    fallback_warning: str | None = None


def resolve(
    request: AnalysisRequest, catalog: Catalog, provider: DataProvider, uploads: UploadProvider
) -> Plan:
    warnings: list[str] = []
    fallback: DataProvider | None = None
    fallback_warning: str | None = None
    aggregation: str = request.aggregation
    bbox = request.bbox
    if request.is_upload:
        dataset = uploads.store.get(request.dataset_id or "")
        if dataset is None:
            raise NotFound(f"Unknown dataset '{request.dataset_id}'.")
        frequency = infer_frequency(uploads.store.load(dataset.id).index)
        variable = dataset_variable(dataset, frequency)
        chosen: DataProvider = uploads
        bbox = None
        if frequency == "annual" and aggregation == "monthly":
            aggregation = "annual"
            warnings.append("Your dataset has one value per year, so it was analyzed as annual data.")
    else:
        found = catalog.get(request.variable_id)
        if found is None:
            raise NotFound(f"Unknown variable '{request.variable_id}'.")
        variable = found
        route = route_for(provider, variable)
        chosen, fallback, fallback_warning = route.provider, route.fallback, route.fallback_warning
        if variable.is_series:
            if bbox is not None:
                warnings.append(
                    f"{variable.name} is a single global record, so the area you selected was not used."
                )
            bbox = None
        elif bbox is None:
            raise InvalidRequest(f"Select an area (bbox) on the map: it is required for {variable.name}.")

    start, end = clamp_period(request.start, request.end, variable, warnings)
    min_years = MIN_YEARS[aggregation]
    if (end - start).days < min_years * 365 - 31:
        raise InvalidRequest(
            f"The date range is too short for {aggregation} analysis: pick at least {min_years} years."
        )
    return Plan(variable=variable, provider=chosen, start=start, end=end, aggregation=aggregation,
                bbox=bbox, warnings=warnings, fallback=fallback, fallback_warning=fallback_warning)


def clamp_period(
    start: dt.date, end: dt.date, variable: CatalogVariable, warnings: list[str]
) -> tuple[dt.date, dt.date]:
    """Clamp to the variable's availability, appending a warning when dates move."""
    lo, hi = variable.available_start, variable.available_end
    if end < lo or start > hi:
        raise InvalidRequest(
            f"{variable.name} is only available from {lo.isoformat()} to {hi.isoformat()}. Pick dates in that range."
        )
    new_start, new_end = max(start, lo), min(end, hi)
    if (new_start, new_end) != (start, end):
        warnings.append(
            f"Dates were adjusted to {new_start.isoformat()} – {new_end.isoformat()}, "
            f"the period when {variable.name} data is available."
        )
    return new_start, new_end
