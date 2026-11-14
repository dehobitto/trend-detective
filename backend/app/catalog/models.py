"""Internal catalog models: the public `Variable` plus server-only hints."""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.schemas.common import Variable


class Hotspot(BaseModel):
    """A Gaussian bump in the synthetic trend factor / climatological mean."""

    lat: float
    lon: float
    radius: float = Field(gt=0, description="e-folding radius in degrees")
    trend: float = 0.0
    base: float = 0.0


class SyntheticHints(BaseModel):
    """Shape of the synthetic signal for one variable (see header of variables.yaml)."""

    base: float
    base_lat: float = 0.0
    amp: float = 0.0
    amp_lat: float = 0.0
    peak_month: int = Field(default=7, ge=1, le=12)
    trend_per_decade: float = 0.0
    bias: float = 0.0
    spread: float = 1.0
    polar_amplification: float = 0.0
    noise: float = 0.1
    noise_lat: float = 0.0
    ar1: float = Field(default=0.3, ge=0, lt=1)
    min: float = float("-inf")
    max: float = float("inf")
    gap_fraction: float = Field(default=0.0, ge=0, lt=0.5)
    hotspots: list[Hotspot] = Field(default_factory=list)


class CatalogVariable(Variable):
    """A catalog entry. Use :meth:`public` before sending it to clients."""

    ratio_scale: bool = True
    """False when percent change is meaningless (temperatures in °C)."""
    synthetic: SyntheticHints | None = None

    def public(self) -> Variable:
        return Variable.model_validate(self.model_dump(include=set(Variable.model_fields)))
