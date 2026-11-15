"""Black Marble (VIIRS night lights) provider: tile geometry, multi-tile combination, uint16 decoding. No network."""

import datetime as dt
import io

import numpy as np
import pandas as pd
import pytest
import xarray as xr

from app.catalog import Catalog
from app.providers import ProviderError, create_provider
from app.providers.blackmarble import PIXEL_DEG, BlackMarbleProvider, granules_by_tile, tile_windows
from app.providers.earthdata import parse_dmr
from app.schemas.common import BBox

DELHI = BBox(west=76.8, south=28.3, east=77.6, north=28.9)
ACROSS = BBox(west=79.5, south=28.0, east=80.5, north=29.0)  # straddles the h25/h26 tile edge at 80°E

DMR = """<?xml version="1.0"?>
<Dataset xmlns="http://xml.opendap.org/ns/DAP/4.0#" name="VNP46A3.h5">
 <Group name="HDFEOS"><Group name="GRIDS"><Group name="VIIRS_Grid_DNB_2d">
  <Dimension name="YDim" size="2400"/><Dimension name="XDim" size="2400"/>
  <Group name="Data_Fields">
   <UInt16 name="NearNadir_Composite_Snow_Free">
     <Dim name="/HDFEOS/GRIDS/VIIRS_Grid_DNB_2d/YDim"/><Dim name="/HDFEOS/GRIDS/VIIRS_Grid_DNB_2d/XDim"/>
     <Attribute name="_FillValue" type="UInt16"><Value>65535</Value></Attribute>
     <Attribute name="scale_factor" type="Float32"><Value>0.1</Value></Attribute>
     <Attribute name="add_offset" type="Float32"><Value>0</Value></Attribute>
   </UInt16>
  </Group></Group></Group></Group>
</Dataset>"""


def test_tile_windows():
    (w,) = tile_windows(DELHI)
    assert w.tile == "h25v06"  # 70-80°E, 30-20°N
    assert (w.row0, w.row1) == (round(1.1 / PIXEL_DEG), round(1.7 / PIXEL_DEG) - 1)
    assert (w.col0, w.col1) == (round(6.8 / PIXEL_DEG), round(7.6 / PIXEL_DEG) - 1)
    assert w.lats()[0] == pytest.approx(28.9 - PIXEL_DEG / 2)
    left, right = tile_windows(ACROSS)
    assert (left.tile, right.tile) == ("h25v06", "h26v06")
    assert left.col1 == 2399 and right.col0 == 0
    assert left.col1 - left.col0 + 1 == right.col1 - right.col0 + 1 == 120


def test_granules_by_tile():
    items = [{"meta": {"native-id": "LAADS:1"}, "umm": {
        "TemporalExtent": {"RangeDateTime": {"BeginningDateTime": "2019-12-01T00:00:00.000Z"}},
        "RelatedUrls": [{"Type": "USE SERVICE API",
                         "URL": "https://ladsweb.modaps.eosdis.nasa.gov/opendap/x/VNP46A3.A2019335.h25v06.002.2025133203853.h5.html"}]}}]
    assert granules_by_tile(items) == {
        "2019-12-01": {"h25v06": "https://ladsweb.modaps.eosdis.nasa.gov/opendap/x/VNP46A3.A2019335.h25v06.002.2025133203853.h5"}}


def packed_nc4(raw: np.ndarray, layout) -> bytes:
    """uint16 subset with packing attributes, like LAADS returns (never decoded by the writer)."""
    da = xr.DataArray(raw.astype("uint16"), dims=["YDim", "XDim"], name=layout.name,
                      attrs={"scale_factor": np.float32(0.1), "add_offset": np.float32(0.0)})
    buf = io.BytesIO()
    da.to_dataset().to_netcdf(buf, engine="h5netcdf", group=layout.group,
                              encoding={layout.name: {"_FillValue": np.uint16(65535)}})
    return buf.getvalue()


@pytest.fixture
def fake_laads(monkeypatch):
    """Two tiles; left tile radiance 10.0 (raw 100), right tile 30.0 (raw 300), one fill pixel each."""
    layout = parse_dmr(DMR, "NearNadir_Composite_Snow_Free")
    calls = []
    months = pd.date_range("2012-01-01", "2014-12-01", freq="MS")
    granules = {m.date().isoformat(): {t: f"https://laads.test/VNP46A3.A{m:%Y%m}.{t}.002.h5" for t in ("h25v06", "h26v06")}
                for m in months}

    class Session:
        def get(self, url, timeout=None):
            calls.append(url)

            class R:
                status_code = 200
            r = R()
            if url.endswith(".dmr"):
                r.content = DMR.encode()
                return r
            rows, cols = 240, 120  # 1° tall, 0.5° wide per tile
            raw = np.full((rows, cols), 100 if ".h25v06." in url else 300)
            raw[0, 0] = 65535
            r.content = packed_nc4(raw, layout)
            return r

    monkeypatch.setattr(BlackMarbleProvider, "_tile_granules", lambda self, *a: granules)
    monkeypatch.setattr(BlackMarbleProvider, "_login", lambda self: None)
    monkeypatch.setattr(BlackMarbleProvider, "_session", lambda self: Session())
    return calls


def test_fetch_combines_tiles_and_caches(settings, fake_laads):
    ntl = Catalog.from_dir().get("viirs_night_lights")
    provider = create_provider("blackmarble", settings.model_copy(update={"earthdata_token": "t"}))
    series = provider.fetch(ntl, ACROSS, dt.date(2012, 1, 1), dt.date(2014, 12, 31))
    assert len(series) == 36
    assert series.iloc[0] == pytest.approx(20.0, rel=1e-3)  # equal-size halves of 10 and 30, scale 0.1 applied once
    data = [c for c in fake_laads if ".dap.nc4" in c]
    assert len(data) == 72 and "Data_Fields/NearNadir_Composite_Snow_Free[" in data[0]

    fake_laads.clear()
    again = create_provider("blackmarble", settings).fetch(ntl, ACROSS, dt.date(2013, 1, 1), dt.date(2013, 12, 31))
    assert fake_laads == [] and len(again) == 12


def test_without_login_nothing_cached_is_an_error(settings):
    ntl = Catalog.from_dir().get("viirs_night_lights")
    with pytest.raises(ProviderError, match="Earthdata login"):
        create_provider("blackmarble", settings).fetch(ntl, DELHI, dt.date(2012, 1, 1), dt.date(2020, 12, 31))
