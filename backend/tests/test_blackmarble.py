"""Black Marble (VIIRS night lights) provider: tile geometry, multi-tile combination, uint16 decoding. No network."""

import datetime as dt
from dataclasses import replace
import re
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
            # answer with the shape the constraint asks for: [start:stop] or [start:stride:stop] per dim
            spans = [(int(a), int(st or 1), int(b)) for a, st, b in re.findall(r"\[(\d+):(?:(\d+):)?(\d+)\]", url)]
            rows, cols = (len(range(a, b + 1, st)) for a, st, b in spans)
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


def test_big_areas_are_sampled_with_a_stride_and_say_so(settings, fake_laads):
    from app.providers.blackmarble import MAX_SAMPLES, pick_stride, tile_windows

    # a city keeps every pixel; a 1° box (240 x 240 px) needs every 2nd; a 5° box every 6th
    assert pick_stride(tile_windows(DELHI)) == 1
    assert pick_stride(tile_windows(ACROSS)) == 2
    big = tile_windows(BBox(west=75.0, south=25.0, east=80.0, north=30.0))
    stride = pick_stride(big)
    assert stride == 6 and sum(len(replace(w, stride=stride).lats()) * len(replace(w, stride=stride).lons())
                               for w in big) <= MAX_SAMPLES

    w = replace(tile_windows(ACROSS)[0], stride=2)
    assert w.constraint(parse_dmr(DMR, "NearNadir_Composite_Snow_Free")).endswith(f"[{w.row0}:2:{w.row1}][{w.col0}:2:{w.col1}]")
    assert len(w.lats()) == len(range(w.row0, w.row1 + 1, 2))

    ntl = Catalog.from_dir().get("viirs_night_lights")
    series = create_provider("blackmarble", settings.model_copy(update={"earthdata_token": "t"})).fetch(
        ntl, ACROSS, dt.date(2012, 1, 1), dt.date(2012, 12, 31))
    assert all(":2:" in c for c in fake_laads if ".dap.nc4" in c)
    assert series.iloc[0] == pytest.approx(20.0, rel=1e-3)
    assert "one pixel in 4" in series.attrs["notes"][0]


def test_moved_box_reuses_the_tiles_it_shares(settings, fake_laads):
    ntl = Catalog.from_dir().get("viirs_night_lights")
    provider = create_provider("blackmarble", settings.model_copy(update={"earthdata_token": "t"}))
    provider.fetch(ntl, ACROSS, dt.date(2012, 1, 1), dt.date(2014, 12, 31))
    fake_laads.clear()
    wider = BBox(west=79.5, south=28.0, east=80.7, north=29.0)  # same h25 window, bigger h26 window
    provider.fetch(ntl, wider, dt.date(2012, 1, 1), dt.date(2014, 12, 31))
    data = [c for c in fake_laads if ".dap.nc4" in c]
    assert len(data) == 36 and all(".h26v06." in c for c in data)


def test_big_download_goes_in_month_passes_with_previews(settings, fake_laads, monkeypatch):
    from app.providers import blackmarble, fetch_partial

    monkeypatch.setattr(blackmarble, "PREVIEW_MIN_JOBS", 1)
    monkeypatch.setattr(blackmarble, "PREVIEW_MIN_YEARS", 2)
    ntl = Catalog.from_dir().get("viirs_night_lights")
    provider = create_provider("blackmarble", settings.model_copy(update={"earthdata_token": "t"}))
    previews = []
    with fetch_partial(lambda series, note: previews.append((series, note))):
        final = provider.fetch(ntl, ACROSS, dt.date(2012, 1, 1), dt.date(2014, 12, 31))
    data = [c for c in fake_laads if ".dap.nc4" in c]
    assert all(re.search(r"\.A201[234]10\.", c) for c in data[:6])  # October of every year first
    assert len(previews) == 11  # after every pass but the last
    first, note = previews[0]
    assert list(first.index.year) == [2012, 2013, 2014] and first.iloc[0] == pytest.approx(20.0, rel=1e-3)
    assert note.startswith("Preliminary: 1 of 12 months")
    assert len(final) == 36


def test_annual_preview_is_not_biased_by_missing_months():
    from app.providers.blackmarble import annual_preview

    # every year: winter 20, summer 10; the trend is +1 per year. 2013 lacks its (bright) January.
    values = {}
    for year in (2012, 2013, 2014):
        values[f"{year}-01-01"] = 20.0 + (year - 2012)
        values[f"{year}-07-01"] = 10.0 + (year - 2012)
    values["2013-01-01"] = None
    out = annual_preview(values)
    assert np.diff(out.to_numpy()) == pytest.approx([1.0, 1.0])
