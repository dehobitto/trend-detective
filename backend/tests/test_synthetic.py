import datetime as dt

import numpy as np

from app.catalog import Catalog
from app.providers.synthetic import SyntheticProvider, trend_per_year
from app.schemas import BBox

CATALOG = Catalog.from_dir()
ARCTIC = BBox(west=10, south=70, east=60, north=82)
TROPICS = BBox(west=-70, south=-12, east=-50, north=0)


def fetch(var_id: str, bbox: BBox, start="1990-01-01", end="2010-12-31"):
    return SyntheticProvider().fetch(CATALOG.get(var_id), bbox, dt.date.fromisoformat(start), dt.date.fromisoformat(end))


def test_deterministic_per_request():
    a, b = fetch("merra2_t2m", ARCTIC), fetch("merra2_t2m", ARCTIC)
    assert a.equals(b)
    assert not a.equals(fetch("merra2_t2m", TROPICS))


def test_changing_dates_is_a_window_on_the_same_series():
    long, short = fetch("merra2_t2m", ARCTIC, "1980-01-01", "2020-12-31"), fetch("merra2_t2m", ARCTIC)
    assert np.allclose(long.loc[short.index], short)


def test_monthly_index_and_realistic_range():
    s = fetch("merra2_t2m", ARCTIC)
    assert s.index.freqstr == "MS" and len(s) == 21 * 12
    assert -45 < s.min() and s.max() < 25
    precip = fetch("gpm_precipitation", TROPICS, "2001-01-01", "2020-12-31")
    assert (precip.dropna() >= 0).all()


def test_seasonal_cycle_is_opposite_in_hemispheres():
    north = fetch("merra2_t2m", BBox(west=0, south=40, east=10, north=50))
    south = fetch("merra2_t2m", BBox(west=140, south=-50, east=150, north=-40))
    assert north[north.index.month == 7].mean() > north[north.index.month == 1].mean()
    assert south[south.index.month == 1].mean() > south[south.index.month == 7].mean()


def test_trends_can_have_opposite_signs_between_regions():
    hints = CATALOG.get("gpm_precipitation").synthetic
    signs = {np.sign(trend_per_year(hints, "gpm_precipitation", lat, lon))
             for lat in range(-60, 61, 20) for lon in range(-180, 180, 30)}
    assert signs >= {-1.0, 1.0}
