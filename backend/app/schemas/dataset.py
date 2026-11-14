"""User-uploaded dataset metadata."""

from __future__ import annotations

import datetime as dt

from pydantic import BaseModel


class Dataset(BaseModel):
    id: str
    name: str
    units: str
    n: int
    start: dt.date
    end: dt.date
    created_at: dt.datetime
