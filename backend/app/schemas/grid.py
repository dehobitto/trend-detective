"""Map frames for the time slider (docs/API.md, "v2 additions")."""

from __future__ import annotations

import datetime as dt

from pydantic import BaseModel

from app.schemas.common import BBox


class Colormap(BaseModel):
    name: str
    stops: list[tuple[float, str]]
    """``[value, "#rrggbb"]`` pairs in the variable's units, ascending; interpolate linearly between them."""


class GridFrame(BaseModel):
    variable_id: str
    date: dt.date
    """First day of the month."""
    bbox: BBox
    """Area actually covered."""
    width: int
    height: int
    """Grid size (cols, rows); row 0 = north."""
    values: list[float | None]
    """Row-major, length width*height; null = no data (e.g. ocean for land variables)."""
    min: float
    max: float
    """Suggested color range for this variable (stable across frames and areas)."""
    units: str
    colormap: Colormap
    synthetic: bool
