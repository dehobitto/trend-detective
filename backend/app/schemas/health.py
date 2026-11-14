from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class Health(BaseModel):
    status: Literal["ok"] = "ok"
    provider: str
    version: str
