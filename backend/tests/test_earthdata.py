"""NASA Earthdata (GES DISC OPeNDAP) provider: DMR parsing, grid indexing, subset reading, cache, routing. No network."""

import datetime as dt
import io
import json

import numpy as np
import pandas as pd
import pytest
import xarray as xr

from app.catalog import Catalog
from app.providers import ProviderError, create_provider
from app.providers.earthdata import (
    GRIDS,
    decode_subset,
    GRIDS,
    Box,
    EarthdataProvider,
    VarLayout,
    cell_range,
    granules_from_umm,
    parse_dmr,
    parse_product,
    read_subset,
    sample_dates,
)
from app.schemas.common import BBox

PUNJAB = BBox(west=73.5, south=28.5, east=77.5, north=32.5)

DMR_ROOT = """<?xml version="1.0" encoding="ISO-8859-1"?>
<Dataset xmlns="http://xml.opendap.org/ns/DAP/4.0#" name="GLDAS.nc4">
  <Dimension name="time" size="1"/><Dimension name="lat" size="600"/><Dimension name="lon" size="1440"/>
  <Float32 name="lat"><Dim name="/lat"/></Float32>
  <Float32 name="GWS_tavg"><Dim name="/time"/><Dim name="/lat"/><Dim name="/lon"/></Float32>
</Dataset>"""

DMR_HDFEOS = """<?xml version="1.0"?>
<Dataset xmlns="http://xml.opendap.org/ns/DAP/4.0#" name="OMNO2d.he5">
 <Group name="HDFEOS"><Group name="GRIDS"><Group name="ColumnAmountNO2">
  <Dimension name="XDim" size="1440"/><Dimension name="YDim" size="720"/>
  <Group name="Data_Fields">
   <Float32 name="ColumnAmountNO2TropCloudScreened">
     <Dim name="/HDFEOS/GRIDS/ColumnAmountNO2/YDim"/><Dim name="/HDFEOS/GRIDS/ColumnAmountNO2/XDim"/>
   </Float32>
  </Group></Group></Group></Group>
</Dataset>"""

DMR_IMERG = """<?xml version="1.0"?>
<Dataset xmlns="http://xml.opendap.org/ns/DAP/4.0#" name="3B-MO.HDF5">
 <Group name="Grid"><Dimension name="time" size="1"/><Dimension name="lon" size="3600"/><Dimension name="lat" size="1800"/>
  <Float32 name="precipitation"><Dim name="/Grid/time"/><Dim name="/Grid/lon"/><Dim name="/Grid/lat"/></Float32>
 </Group>
</Dataset>"""


def nc4_bytes(values: np.ndarray, layout: VarLayout, fill: float | None = None) -> bytes:
    """A NetCDF-4 file shaped like an OPeNDAP DAP4 subset response."""
    names = {"time": "time", "lat": "lat", "lon": "lon"}
    da = xr.DataArray(values.astype("float32"), dims=[names[d] for d in layout.dims], name=layout.name)
    encoding = {layout.name: {"_FillValue": np.float32(fill)}} if fill is not None else {}
    buffer = io.BytesIO()
    da.to_dataset().to_netcdf(buffer, engine="h5netcdf", group=layout.group, encoding=encoding)
    return buffer.getvalue()


def test_parse_product_and_dmr_layouts():
    assert parse_product("GLDAS_CLSM025_DA1_D.2.2:GWS_tavg") == ("GLDAS_CLSM025_DA1_D", "2.2", "GWS_tavg")
    assert parse_product("M2TMNXAER.5.12.4:DUSMASS") == ("M2TMNXAER", "5.12.4", "DUSMASS")
    with pytest.raises(ProviderError):
        parse_product("NOAA-GML:co2_mm_mlo")

    root = parse_dmr(DMR_ROOT, "GWS_tavg")
    assert root == VarLayout("/GWS_tavg", ("time", "lat", "lon")) and root.group is None
    omi = parse_dmr(DMR_HDFEOS, "ColumnAmountNO2TropCloudScreened")
    assert omi.dims == ("lat", "lon") and omi.group == "HDFEOS/GRIDS/ColumnAmountNO2/Data_Fields"
    imerg = parse_dmr(DMR_IMERG, "precipitation")
    assert imerg.dims == ("time", "lon", "lat") and imerg.group == "Grid"
    assert imerg.constraint(Box(1, 2, 3, 4)) == "/Grid/precipitation[0][3:4][1:2]"
    with pytest.raises(ProviderError, match="not found"):
        parse_dmr(DMR_ROOT, "TWS_tavg")


def test_cell_range_and_box():
    g = GRIDS["GLDAS_CLSM025_DA1_D"]
    lat0, lat1 = cell_range(g.lat_start, g.lat_step, g.lat_n, 28.5, 32.5)
    lats = g.lat_start + g.lat_step * np.arange(lat0, lat1 + 1)
    assert lats[0] == pytest.approx(28.625) and lats[-1] == pytest.approx(32.375)  # cells inside the box
    # a box smaller than one cell still gets that cell; out-of-grid latitudes are clamped
    assert cell_range(g.lat_start, g.lat_step, g.lat_n, 30.01, 30.02) == (360, 360)
    assert cell_range(g.lat_start, g.lat_step, g.lat_n, -80, -70) == (0, 0)
    box = Box.for_bbox(GRIDS["M2TMNXAER"], PUNJAB)
    assert box.key == f"{box.lat0}-{box.lat1}_{box.lon0}-{box.lon1}"


def test_read_subset_weights_masks_and_transposes():
    grid = GRIDS["GPM_3IMERGM"]
    box = Box(lat0=1000, lat1=1001, lon0=2000, lon1=2002)  # 2 lat x 3 lon
    by_lat = np.array([[1.0, 2.0, 3.0], [4.0, np.nan, 6.0]])
    layout = parse_dmr(DMR_IMERG, "precipitation")  # stored (time, lon, lat)
    content = nc4_bytes(by_lat.T[None, :, :], layout, fill=-9999.9)
    weights = np.cos(np.deg2rad(box.lats(grid)))[:, None] * np.ones((2, 3))
    expected = np.nansum(by_lat * weights) / weights[~np.isnan(by_lat)].sum()
    assert read_subset(content, layout, grid, box) == pytest.approx(expected)

    omi = GRIDS["OMNO2d"]
    layout = parse_dmr(DMR_HDFEOS, "ColumnAmountNO2TropCloudScreened")
    raw = np.array([[2e15, -1.2676506e30], [4e15, -5.0]])  # fill and negative values are not data
    value = read_subset(nc4_bytes(raw, layout), layout, omi, Box(400, 401, 900, 901))
    assert 2e15 < value < 4e15
    all_missing = nc4_bytes(np.full((2, 2), -1.2676506e30), layout)
    assert np.isnan(read_subset(all_missing, layout, omi, Box(400, 401, 900, 901)))


def test_sampling_and_cmr_parsing():
    days = {dt.date(2015, 1, d): f"u{d}" for d in range(1, 32)}
    assert sample_dates(days, GRIDS["GLDAS_CLSM025_DA1_D"], dt.date(2015, 1, 1), dt.date(2015, 1, 31)) == [dt.date(2015, 1, 1)]
    assert len(sample_dates(days, GRIDS["OMNO2d"], dt.date(2015, 1, 1), dt.date(2015, 1, 31))) == 4
    items = [{"umm": {
        "TemporalExtent": {"RangeDateTime": {"BeginningDateTime": "2015-01-01T00:00:00.000Z"}},
        "RelatedUrls": [{"Type": "GET DATA", "URL": "https://data/x.nc4"},
                        {"Type": "USE SERVICE API", "URL": "https://opendap.earthdata.nasa.gov/collections/C1/granules/x.nc4"}],
    }}]
    assert granules_from_umm(items) == {dt.date(2015, 1, 1): "https://opendap.earthdata.nasa.gov/collections/C1/granules/x.nc4"}


class FakeResponse:
    def __init__(self, content: bytes, status_code: int = 200):
        self.content, self.status_code = content, status_code


@pytest.fixture
def fake_nasa(monkeypatch):
    """A fake GES DISC: monthly IMERG granules whose area mean is 0.1 * month index (mm/hr)."""
    layout = parse_dmr(DMR_IMERG, "precipitation")
    calls: list[str] = []
    months = pd.date_range("2003-01-01", "2012-12-01", freq="MS")
    urls = {m.date(): f"https://opendap.test/granules/imerg_{m:%Y%m}.HDF5" for m in months}

    def search_year(self, short_name, version, year):
        return {d: u for d, u in urls.items() if d.year == year}

    class Session:
        def get(self, url, timeout=None):
            calls.append(url)
            if url.endswith(".dmr"):
                return FakeResponse(DMR_IMERG.encode())
            stamp = url.split("imerg_")[1][:6]
            i = months.get_loc(pd.Timestamp(f"{stamp[:4]}-{stamp[4:]}-01"))
            box = Box.for_bbox(GRIDS["GPM_3IMERGM"], PUNJAB)
            shape = (1, box.lon1 - box.lon0 + 1, box.lat1 - box.lat0 + 1)
            return FakeResponse(nc4_bytes(np.full(shape, 0.1 * i), layout))

    monkeypatch.setattr(EarthdataProvider, "_search_year", search_year)
    monkeypatch.setattr(EarthdataProvider, "_login", lambda self: None)
    monkeypatch.setattr(EarthdataProvider, "_session", lambda self: Session())
    return calls


def test_fetch_downloads_converts_and_caches(settings, fake_nasa):
    logged_in = settings.model_copy(update={"earthdata_token": "test-token"})
    provider = create_provider("earthdata", logged_in)
    precip = Catalog.from_dir().get("gpm_precipitation")
    series = provider.fetch(precip, PUNJAB, dt.date(2003, 1, 1), dt.date(2012, 12, 31))
    assert len(series) == 120 and series.index[0] == pd.Timestamp("2003-01-01")
    assert series.iloc[10] == pytest.approx(0.1 * 10 * 24, rel=1e-5)  # mm/hr -> mm/day
    data_calls = [c for c in fake_nasa if ".dap.nc4" in c]
    assert len(data_calls) == 120 and "dap4.ce=/Grid/precipitation[0][" in data_calls[0]

    # second request (narrower range): served from the disk cache, even by a new provider without a login
    fake_nasa.clear()
    again = create_provider("earthdata", settings).fetch(precip, PUNJAB, dt.date(2005, 1, 1), dt.date(2006, 12, 31))
    assert fake_nasa == [] and len(again) == 24
    assert again.iloc[0] == pytest.approx(series.loc["2005-01-01"])
    cache_files = list((settings.cache_dir / "earthdata" / "GPM_3IMERGM" / "values").glob("*.json"))
    assert len(cache_files) == 1 and len(json.loads(cache_files[0].read_text())) == 120


def test_without_login_an_uncached_area_is_an_error(settings, fake_nasa):
    provider = create_provider("earthdata", settings)
    precip = Catalog.from_dir().get("gpm_precipitation")
    assert not provider.has_login
    with pytest.raises(ProviderError, match="Earthdata login"):
        provider.fetch(precip, PUNJAB, dt.date(2003, 1, 1), dt.date(2012, 12, 31))


def test_settings_accept_the_team_env_names(monkeypatch):
    from app.config import Settings

    monkeypatch.setenv("EARTHDATA_USER", "student")
    monkeypatch.setenv("EARTHDATA_PASS", "secret")
    s = Settings(_env_file=None)
    assert s.earthdata_username == "student" and s.earthdata_password == "secret"


def test_cmr_search_retries_a_dropped_connection(settings, monkeypatch):
    import httpx

    calls = []

    def flaky(url, params=None, headers=None, timeout=None):
        calls.append(url)
        if len(calls) == 1:
            raise httpx.ReadError("Connection reset by peer")
        item = {"umm": {"TemporalExtent": {"RangeDateTime": {"BeginningDateTime": "2006-03-01T00:00:00Z"}},
                        "RelatedUrls": [{"Type": "USE SERVICE API", "URL": "https://opendap.test/x"}]}}
        return httpx.Response(200, json={"items": [item]}, request=httpx.Request("GET", url))

    monkeypatch.setattr("app.providers.earthdata.httpx.get", flaky)
    monkeypatch.setattr("app.providers.earthdata.time.sleep", lambda s: None)
    found = create_provider("earthdata", settings)._search_year("GPM_3IMERGM", "07", 2006)
    assert found == {dt.date(2006, 3, 1): "https://opendap.test/x"} and len(calls) == 2


MODIS_DMR = """<?xml version="1.0"?>
<Dataset xmlns="http://xml.opendap.org/ns/DAP/4.0#" name="MOD13C2.A2019001.061.hdf">
  <Dimension name="YDim_MOD_Grid_monthly_CMG_VI" size="3600"/>
  <Dimension name="XDim_MOD_Grid_monthly_CMG_VI" size="7200"/>
  <Int16 name="CMG_0_05_Deg_Monthly_NDVI">
    <Dim name="/YDim_MOD_Grid_monthly_CMG_VI"/>
    <Dim name="/XDim_MOD_Grid_monthly_CMG_VI"/>
    <Attribute name="_FillValue" type="Int16"><Value>-3000</Value></Attribute>
    <Attribute name="scale_factor" type="Float64"><Value>10000.0</Value></Attribute>
  </Int16>
</Dataset>"""


def test_modis_cmg_grid_runs_north_to_south_and_ndvi_is_divided():
    grid = GRIDS["MOD13C2"]
    layout = parse_dmr(MODIS_DMR, "CMG_0_05_Deg_Monthly_NDVI")
    assert layout.dims == ("lat", "lon") and layout.path == "/CMG_0_05_Deg_Monthly_NDVI"

    # Phoenix-sized box: rows count down from the north pole, so north maps to the smaller row index.
    box = Box.for_bbox(grid, BBox(west=-112.5, south=33.2, east=-111.6, north=33.8))
    assert (box.lat0, box.lat1) == (1124, 1135) and (box.lon0, box.lon1) == (1350, 1367)
    lats = box.lats(grid)
    assert lats[0] == pytest.approx(33.775) and lats[-1] == pytest.approx(33.225)
    # a box whose edges are cell edges gets exactly the cells inside, no neighbor
    two = Box.for_bbox(grid, BBox(west=10.0, south=50.0, east=10.1, north=50.1))
    assert two.lat1 - two.lat0 == 1 and two.lon1 - two.lon0 == 1
    assert list(two.lats(grid)) == pytest.approx([50.075, 50.025])

    # The file says scale_factor = 10000 but MODIS VI means "divide": the grid override wins.
    raw = np.array([[5000, -3000], [2500, 10000]], dtype=np.int16)
    ds = xr.Dataset({"CMG_0_05_Deg_Monthly_NDVI": (("y", "x"), raw)})
    ds["CMG_0_05_Deg_Monthly_NDVI"].attrs.update({"_FillValue": -3000, "scale_factor": 10000.0})
    buf = io.BytesIO(ds.to_netcdf(engine="h5netcdf"))
    values = decode_subset(buf.getvalue(), layout, 2, 2, overrides=grid.packing)
    assert values[0, 0] == pytest.approx(0.5) and np.isnan(values[0, 1]) and values[1, 1] == pytest.approx(1.0)


def test_big_area_takes_every_nth_cell():
    grid = GRIDS["MOD11C3"]
    small = Box.for_bbox(grid, PUNJAB)  # 80 x 80 cells: under the cap, whole box, old cache key
    assert small.step == 1 and "_s" not in small.key
    big = Box.for_bbox(grid, BBox(west=0.0, south=0.0, east=90.0, north=60.0))  # 1200 x 1800 cells
    assert big.step == 8 and big.key.endswith("_s8")
    lats, lons = big.lats(grid), big.lons(grid)
    assert len(lats) * len(lons) <= 40_000
    assert len(lats) == len(range(big.lat0, big.lat1 + 1, 8)) and lats[1] - lats[0] == pytest.approx(-0.4)
    layout = VarLayout("/LST_Day_CMG", ("lat", "lon"))
    assert layout.constraint(big) == f"/LST_Day_CMG[{big.lat0}:8:{big.lat1}][{big.lon0}:8:{big.lon1}]"

    # read_subset sizes the response from the sampled cells
    box = Box(lat0=0, lat1=4, lon0=0, lon1=6, step=2)  # 3 x 4 sampled cells
    values = np.full((3, 4), 300.0)
    ds = xr.Dataset({"LST_Day_CMG": (("y", "x"), values)})
    content = ds.to_netcdf(engine="h5netcdf")
    assert read_subset(content, layout, grid, box) == pytest.approx(300.0)


def test_cold_granule_years_are_searched_in_parallel(settings, monkeypatch):
    import threading
    import time as _time

    active, peak, lock = [0], [0], threading.Lock()

    def search_year(self, short_name, version, year):
        with lock:
            active[0] += 1
            peak[0] = max(peak[0], active[0])
        _time.sleep(0.05)
        with lock:
            active[0] -= 1
        return {dt.date(year, m, 1): f"u{year}{m}" for m in range(1, 13)}

    monkeypatch.setattr(EarthdataProvider, "_search_year", search_year)
    provider = create_provider("earthdata", settings)
    granules = provider._granules("GPM_3IMERGM", "07", dt.date(2001, 1, 1), dt.date(2010, 12, 31))
    assert len(granules) == 120 and peak[0] > 1
    monkeypatch.setattr(EarthdataProvider, "_search_year", lambda *a: pytest.fail("cached years searched again"))
    assert provider._granules("GPM_3IMERGM", "07", dt.date(2001, 1, 1), dt.date(2010, 12, 31)) == granules
