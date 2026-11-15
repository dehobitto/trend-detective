"""Test-only data provider: deterministic monthly series so API tests run offline (never used by the app)."""

from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd

from app.catalog.models import CatalogVariable
from app.config import Settings
from app.providers.base import register_provider
from app.schemas.common import BBox

FALLING = {"gldas_gws", "gldas_tws", "merra2_so2", "merra2_so4", "modis_ndvi"}
FLAT = {"gpm_precipitation"}


class FakeProvider:
    """Trend (per decade: +/-1, or 0) + seasonal cycle + seeded noise, around 10 units."""

    name = "fake"

    def __init__(self, settings: Settings) -> None:
        pass

    def fetch(self, variable: CatalogVariable, bbox: BBox | None, start: dt.date, end: dt.date) -> pd.Series:
        index = pd.date_range(pd.Timestamp(start).replace(day=1), pd.Timestamp(end), freq="MS")
        years = (index.year - 2000) + (index.month - 1) / 12
        slope = 0.0 if variable.id in FLAT else (-0.1 if variable.id in FALLING else 0.1)
        rng = np.random.default_rng(abs(hash(variable.id)) % 2**32)
        values = 10 + slope * years + 0.5 * np.sin(2 * np.pi * index.month / 12) + rng.normal(0, 0.05, len(index))
        return pd.Series(values, index=index, name=variable.id)


@register_provider("fake")
def _factory(settings: Settings) -> FakeProvider:
    return FakeProvider(settings)
