"""Place search results (docs/API.md, "v2 additions")."""

from __future__ import annotations

from pydantic import BaseModel

from app.schemas.common import BBox


class Place(BaseModel):
    name: str
    display_name: str
    lat: float
    lon: float
    bbox: BBox | None
    kind: str
    """What the place is, e.g. "city", "country", "state", "river"."""
