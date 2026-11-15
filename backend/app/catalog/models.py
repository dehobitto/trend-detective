"""Internal catalog models: the public `Variable` plus server-only fields (unit conversion, ratio scale)."""

from __future__ import annotations

from pydantic import BaseModel, model_validator

from app.schemas.common import Variable


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

    @model_validator(mode="after")
    def _check(self) -> "CatalogVariable":
        if self.is_series and self.map_layer is not None:
            raise ValueError(f"{self.id}: 'series' variables have map_layer: null")
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
