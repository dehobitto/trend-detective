"""Shared types: BBox, Variable, ExampleCase (see docs/API.md)."""

from __future__ import annotations

import datetime as dt
from typing import Literal

from pydantic import BaseModel, model_validator

Sphere = Literal["atmosphere", "land", "ocean", "water"]
Coverage = Literal["global", "land", "ocean", "series"]
"""``series`` = a ready-made single time series (a station such as Mauna Loa, or a global mean): no bbox."""

MIN_BBOX_SPAN_DEG = 0.05


class BBox(BaseModel):
    """Lon/lat rectangle in degrees. No antimeridian crossing in v1."""

    west: float
    south: float
    east: float
    north: float

    @model_validator(mode="after")
    def _check(self) -> "BBox":
        if not (-180 <= self.west <= 180 and -180 <= self.east <= 180):
            raise ValueError("Longitudes must be between -180 and 180.")
        if not (-90 <= self.south <= 90 and -90 <= self.north <= 90):
            raise ValueError("Latitudes must be between -90 and 90.")
        if self.west >= self.east:
            raise ValueError("West must be smaller than east (areas crossing the 180° line are not supported).")
        if self.south >= self.north:
            raise ValueError("South must be smaller than north.")
        if self.east - self.west < MIN_BBOX_SPAN_DEG or self.north - self.south < MIN_BBOX_SPAN_DEG:
            raise ValueError(f"The area is too small: make it at least {MIN_BBOX_SPAN_DEG}° wide and tall.")
        return self

    @property
    def center(self) -> tuple[float, float]:
        """(lat, lon) of the box center."""
        return (self.south + self.north) / 2, (self.west + self.east) / 2


class LatLon(BaseModel):
    lat: float
    lon: float


class Location(LatLon):
    label: str


class Variable(BaseModel):
    id: str
    name: str
    short_definition: str
    why_it_matters: str
    units: str
    sphere: Sphere
    source: str
    mission_or_model: str
    product: str
    temporal_resolution: Literal["daily", "monthly"]
    available_start: dt.date
    available_end: dt.date
    coverage: Coverage
    dataset: str
    """Dataset name as the team uses it, e.g. "GLDAS_CLSM025_DA1_D v2.2"."""
    access: str
    """How real data is obtained: "Giovanni" | "AppEEARS" | "GES DISC OPeNDAP" | "NOAA GML" | "KNMI Climate Explorer"."""
    location: Location | None = None
    """Station position for "series" variables measured at one place (Mauna Loa), else null."""

    @property
    def is_series(self) -> bool:
        return self.coverage == "series"


class ExampleCase(BaseModel):
    id: str
    title: str
    question: str
    bbox: BBox | None
    """Null only for "series" variables (a single global/station record)."""
    variable_id: str
    start: dt.date
    end: dt.date
    deseasonalize: bool
    center: LatLon
    related_variable_id: str | None = None
    """Optional "compare with" variable for the same region (e.g. groundwater vs rainfall)."""
    takeaway: str | None = None
    """One sentence explaining what the trend (or the pair) shows."""

