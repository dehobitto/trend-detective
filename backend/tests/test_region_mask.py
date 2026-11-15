"""Named-region masks: squares -> grid cells, masked area means, skipped Black Marble tiles. No network."""

import datetime as dt

import numpy as np
import pytest

from app.catalog import Catalog
from app.providers import create_provider
from app.providers.base import fetch_mask, mask_grid, mask_key
from app.providers.earthdata import GRIDS, Box, parse_dmr, read_subset
from app.regions import approximate, cells_union_area
from app.schemas.common import BBox

from tests.test_blackmarble import ACROSS, fake_laads  # noqa: F401  (fixture)
from tests.test_earthdata import DMR_ROOT, nc4_bytes


def sq(w, s, e, n):
    return BBox(west=w, south=s, east=e, north=n)


def test_mask_grid_handles_both_latitude_orders_and_tiny_regions():
    lats_up = np.array([10.125, 10.375, 10.625])
    lons = np.array([20.125, 20.375])
    m = mask_grid((sq(20.0, 10.0, 20.25, 10.5),), lats_up, lons)
    assert m.tolist() == [[True, False], [True, False], [False, False]]
    m_down = mask_grid((sq(20.0, 10.0, 20.25, 10.5),), lats_up[::-1], lons)  # rows north -> south (MODIS CMG)
    assert m_down.tolist() == [[False, False], [True, False], [True, False]]
    tiny = mask_grid((sq(20.26, 10.26, 20.36, 10.36),), lats_up, lons)  # catches no centre: nearest cell instead
    assert tiny.sum() == 1 and tiny[1, 1]
    assert mask_key(None) == "" and mask_key((sq(0, 0, 1, 1),)).startswith("_m")


def test_read_subset_averages_only_inside_the_mask():
    grid = GRIDS["GLDAS_CLSM025_DA1_D"]
    box = Box(lat0=400, lat1=401, lon0=800, lon1=801)
    layout = parse_dmr(DMR_ROOT, "GWS_tavg")
    raw = np.array([[[10.0, 20.0], [30.0, 1000.0]]])
    mask = np.array([[True, True], [True, False]])
    value = read_subset(nc4_bytes(raw, layout), layout, grid, box, mask)
    assert 10.0 < value < 30.0  # the 1000 outside the region is ignored


def test_blackmarble_skips_tiles_without_squares(settings, fake_laads):  # noqa: F811
    ntl = Catalog.from_dir().get("viirs_night_lights")
    provider = create_provider("blackmarble", settings.model_copy(update={"earthdata_token": "t"}))
    left_only = [sq(79.5, 28.0, 80.0, 29.0)]  # all inside tile h25v06
    with fetch_mask(left_only):
        series = provider.fetch(ntl, ACROSS, dt.date(2012, 1, 1), dt.date(2012, 12, 31))
    data_calls = [c for c in fake_laads if ".dap.nc4" in c]
    assert data_calls and all(".h25v06." in c for c in data_calls)
    assert series.iloc[0] == pytest.approx(10.0, rel=1e-3)  # only the left tile's radiance


def test_approximate_a_triangle():
    triangle = {"type": "Polygon", "coordinates": [[[0, 0], [4, 0], [0, 4], [0, 0]]]}
    cells, step, union, outline = approximate(triangle, max_cells=64)  # explicit cap: 0.5° squares
    assert step == 0.5 and 20 <= len(cells) <= 40
    assert union.west == 0 and union.south == 0 and union.east <= 4 and union.north <= 4
    assert 6 <= cells_union_area(cells) <= 10  # triangle area is 8
    assert outline["type"] == "Polygon"
