"""Turn an AnalysisRequest into a concrete plan: which variable, which provider, which dates.

Used twice: by the API at submit time (so bad requests fail fast with 404/422) and by the job runner.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field

from app.catalog import Catalog, CatalogVariable
from app.processing.timeseries import infer_frequency
from app.providers import DataProvider, UploadProvider, dataset_variable
from app.schemas.analysis import AnalysisRequest

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
    warnings: list[str] = field(default_factory=list)


def resolve(
    request: AnalysisRequest, catalog: Catalog, provider: DataProvider, uploads: UploadProvider
) -> Plan:
    warnings: list[str] = []
    aggregation: str = request.aggregation
    if request.is_upload:
        dataset = uploads.store.get(request.dataset_id or "")
        if dataset is None:
            raise NotFound(f"Unknown dataset '{request.dataset_id}'.")
        frequency = infer_frequency(uploads.store.load(dataset.id).index)
        variable = dataset_variable(dataset, frequency)
        chosen: DataProvider = uploads
        if frequency == "annual" and aggregation == "monthly":
            aggregation = "annual"
            warnings.append("Your dataset has one value per year, so it was analyzed as annual data.")
    else:
        found = catalog.get(request.variable_id)
        if found is None:
            raise NotFound(f"Unknown variable '{request.variable_id}'.")
        variable, chosen = found, provider

    start, end = clamp_period(request.start, request.end, variable, warnings)
    min_years = MIN_YEARS[aggregation]
    if (end - start).days < min_years * 365 - 31:
        raise InvalidRequest(
            f"The date range is too short for {aggregation} analysis: pick at least {min_years} years."
        )
    return Plan(variable=variable, provider=chosen, start=start, end=end, aggregation=aggregation, warnings=warnings)


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
