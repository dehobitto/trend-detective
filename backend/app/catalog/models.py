"""Internal catalog models: the public `Variable` plus server-only hints."""

from __future__ import annotations

import datetime as dt

from pydantic import BaseModel, Field, model_validator

from app.schemas.common import Variable


class Hotspot(BaseModel):
    """A Gaussian bump in the synthetic trend factor / climatological mean / seasonal amplitude."""

    lat: float
    lon: float
    radius: float = Field(gt=0, description="e-folding radius in degrees")
    trend: float = 0.0
    """Trend factor (multiplies ``trend_per_decade``); after ``break_year`` if one is set."""
    base: float = 0.0
    """Offset of the climatological mean, in catalog units."""
    amp: float = 0.0
    """Extra half-range of the seasonal cycle, in catalog units."""
    break_year: float | None = None
    """If set, the local trend changes at this (decimal) year: ``trend_before`` before, ``trend`` after."""
    trend_before: float = 0.0
    damp: float = Field(default=0.0, ge=0, le=1)
    """Suppress the smooth background trend here (1 = no background trend at the hotspot center)."""


class Dip(BaseModel):
    """A temporary drop of all hotspot (local, mostly human-made) excess, e.g. the 2020 lockdowns."""

    start: dt.date
    end: dt.date
    fraction: float = Field(gt=0, le=1)
    """Share of the hotspot excess removed during [start, end]."""


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
    noise_rel: float = 0.0
    """Extra noise proportional to the local mean level (polluted / wet places vary more)."""
    ar1: float = Field(default=0.3, ge=0, lt=1)
    min: float = float("-inf")
    max: float = float("inf")
    gap_fraction: float = Field(default=0.0, ge=0, lt=0.5)
    hotspots: list[Hotspot] = Field(default_factory=list)
    dips: list[Dip] = Field(default_factory=list)
    curve: list[tuple[float, float]] | None = None
    """"series" variables only: [[decimal_year, value], ...] knots of the long-term curve (linear between)."""


class UnitConversion(BaseModel):
    """How a real provider turns the product's native units into catalog units: ``value * scale + offset``."""

    native_units: str
    scale: float = 1.0
    offset: float = 0.0
    note: str | None = None


class CatalogVariable(Variable):
    """A catalog entry. Use :meth:`public` before sending it to clients."""

    ratio_scale: bool = True
    """False when percent change is meaningless (temperatures in °C)."""
    conversion: UnitConversion | None = None
    """Native product units -> catalog units, for real-data providers. None means already in catalog units."""
    synthetic: SyntheticHints | None = None
    colormap: str | None = None
    """Name of the map colormap in colormaps.yaml (area variables)."""

    @model_validator(mode="after")
    def _check(self) -> "CatalogVariable":
        if self.is_series and self.map_layer is not None:
            raise ValueError(f"{self.id}: 'series' variables have map_layer: null")
        if self.is_series and self.synthetic is not None and not self.synthetic.curve:
            raise ValueError(f"{self.id}: 'series' variables need a synthetic.curve")
        if self.location is not None and not self.is_series:
            raise ValueError(f"{self.id}: only 'series' variables have a location")
        return self

    def to_catalog_units(self, values):
        """Apply ``conversion`` (works on floats, numpy arrays and pandas objects)."""
        if self.conversion is None:
            return values
        return values * self.conversion.scale + self.conversion.offset

    def public(self) -> Variable:
        return Variable.model_validate(self.model_dump(include=set(Variable.model_fields)))
