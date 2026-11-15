"""Analysis request / job / result models (see docs/API.md)."""

from __future__ import annotations

import datetime as dt
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.schemas.common import BBox, Variable

Aggregation = Literal["monthly", "annual"]
JobStatus = Literal["queued", "fetching", "processing", "analyzing", "done", "error"]
Direction = Literal["rising", "falling", "flat"]

UPLOAD_PREFIX = "upload:"


class AnalysisRequest(BaseModel):
    bbox: BBox | None = None
    """Required for catalog variables with an area; ignored for "series" variables and ``upload:<id>`` datasets.

    Whether it is required depends on the catalog, so that check lives in ``jobs.resolve`` (HTTP 422)."""
    variable_id: str = Field(min_length=1)
    start: dt.date
    end: dt.date
    aggregation: Aggregation = "monthly"
    deseasonalize: bool | None = None
    """Defaults to true for monthly, false for annual."""
    alpha: float = Field(default=0.05, gt=0, lt=0.5)
    cells: list[BBox] | None = Field(default=None, max_length=600)
    """A named region approximated by grid squares (``/api/regions/shape``): the average covers only these
    squares. ``bbox`` should be their bounding box. Ignored for "series" variables and uploads."""
    region_name: str | None = Field(default=None, max_length=120)
    """Display name of that region (echoed in the result)."""

    @model_validator(mode="after")
    def _check(self) -> "AnalysisRequest":
        if self.start >= self.end:
            raise ValueError("Start date must be before end date.")
        if self.deseasonalize is None:
            self.deseasonalize = self.aggregation == "monthly"
        return self

    @property
    def is_upload(self) -> bool:
        return self.variable_id.startswith(UPLOAD_PREFIX)

    @property
    def dataset_id(self) -> str | None:
        return self.variable_id[len(UPLOAD_PREFIX):] if self.is_upload else None


class SeriesPoint(BaseModel):
    date: dt.date
    value: float | None
    deseasonalized: float | None
    trend: float | None
    ci_low: float | None
    ci_high: float | None


class TrendStats(BaseModel):
    n: int
    slope_per_year: float
    slope_per_decade: float
    slope_ci_low_per_decade: float
    slope_ci_high_per_decade: float
    intercept: float
    r_squared: float
    t_stat: float
    p_value: float
    mk_tau: float
    mk_z: float
    mk_p_value: float
    sens_slope_per_decade: float
    total_change: float
    percent_change: float | None
    direction: Direction
    significant: bool
    alpha: float


class AnalysisResult(BaseModel):
    variable: Variable
    bbox: BBox | None
    analyzed_series: Literal["raw", "deseasonalized"]
    series: list[SeriesPoint]
    stats: TrendStats
    summary: str
    provider: str
    region_name: str | None = None
    """Set when the request averaged over a named region's squares."""
    warnings: list[str]


class Job(BaseModel):
    id: str
    status: JobStatus
    progress: float = Field(ge=0, le=1)
    message: str | None
    request: AnalysisRequest
    result: AnalysisResult | None
    created_at: dt.datetime
