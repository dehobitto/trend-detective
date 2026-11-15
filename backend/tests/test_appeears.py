"""NASA AppEEARS provider: statistics parsing, scaling, task lifecycle and cache. No network."""

import datetime as dt

import httpx
import pandas as pd
import pytest

from app.catalog import Catalog
from app.providers import ProviderError, create_provider
from app.providers.appeears import LAYERS, TaskPending, apply_scale, parse_product, parse_statistics, statistics_file, task_payload
from app.schemas.common import BBox

PHOENIX = BBox(west=-112.5, south=33.2, east=-111.6, north=33.8)

STATS = """File Name,Dataset,aid,Date,Count,Minimum,Maximum,Range,Mean,Standard Deviation,Variance,Upper Quartile,Upper 1.5 IQR,Median,Lower 1.5 IQR,Lower Quartile
MOD11A2_LST_Night_1km_doy2001001_aid0001,LST_Night_1km,aid0001,2001-01-01,500,270.0,290.0,20.0,280.0,3.0,9.0,282,290,280,270,278
MOD11A2_LST_Night_1km_doy2001009_aid0001,LST_Night_1km,aid0001,2001-01-09,500,272.0,292.0,20.0,282.0,3.0,9.0,284,292,282,272,280
MOD11A2_LST_Night_1km_doy2001017_aid0001,LST_Night_1km,aid0001,2001-01-17,0,,,,,,,,,,,
MOD11A2_QC_Night_doy2001001_aid0001,QC_Night,aid0001,2001-01-01,500,0,3,3,1.0,1,1,1,1,1,1,1
MOD11A2_LST_Night_1km_doy2001033_aid0001,LST_Night_1km,aid0001,2001-02-02,500,280.0,300.0,20.0,290.0,3.0,9.0,292,300,290,280,288
"""


def test_helpers():
    assert parse_product("MOD13A3.061:_1_km_monthly_NDVI") == ("MOD13A3.061", "_1_km_monthly_NDVI")
    payload = task_payload("t", "MOD11A2.061", "LST_Day_1km", PHOENIX, dt.date(2000, 3, 1), dt.date(2025, 12, 31))
    assert payload["task_type"] == "area"
    assert payload["params"]["dates"] == [{"startDate": "03-01-2000", "endDate": "12-31-2025"}]
    ring = payload["params"]["geo"]["features"][0]["geometry"]["coordinates"][0]
    assert ring[0] == ring[-1] == [-112.5, 33.2] and len(ring) == 5

    files = [{"file_name": "MOD11A2.061_2000_doy.tif", "file_id": "1"},
             {"file_name": "MOD11A2-061-QC-Statistics.csv", "file_id": "2"},
             {"file_name": "MOD11A2-061-Statistics.csv", "file_id": "3"}]
    assert statistics_file(files, "MOD11A2.061")["file_id"] == "3"
    assert statistics_file(files[:2], "MOD11A2.061") is None


def test_parse_statistics_and_scale():
    s = parse_statistics(STATS, "LST_Night_1km")
    assert list(s.index) == [pd.Timestamp("2001-01-01"), pd.Timestamp("2001-01-09"), pd.Timestamp("2001-02-02")]
    assert s.iloc[0] == 280.0  # QC row and the zero-count date are ignored
    lst = LAYERS[("MOD11A2.061", "LST_Night_1km")]
    assert apply_scale(s, lst).equals(s)  # already Kelvin
    raw = pd.Series([14000.0, 14100.0])
    assert apply_scale(raw, lst).tolist() == pytest.approx([280.0, 282.0])  # raw integers x 0.02
    ndvi = LAYERS[("MOD13A3.061", "_1_km_monthly_NDVI")]
    assert apply_scale(pd.Series([6500.0, 7000.0]), ndvi).tolist() == pytest.approx([0.65, 0.70])
    with pytest.raises(ProviderError):
        parse_statistics("a,b\n1,2\n", "LST_Night_1km")


@pytest.fixture
def fake_appeears(monkeypatch):
    """Login, one task that is 'processing' for the first ``pending`` status checks, then a bundle with STATS."""
    state = {"pending": 1, "submitted": 0, "calls": []}

    def respond(method, url, json=None):
        req = httpx.Request(method, url)
        return httpx.Response(200, json=json, request=req) if json is not None else None

    def post(url, auth=None, timeout=None):
        assert auth == ("student", "secret")
        return httpx.Response(200, json={"token": "tok"}, request=httpx.Request("POST", url))

    def request(method, url, headers=None, timeout=None, **kwargs):
        state["calls"].append((method, url))
        assert headers == {"Authorization": "Bearer tok"}
        req = httpx.Request(method, url)
        if method == "POST" and url.endswith("/task"):
            state["submitted"] += 1
            assert kwargs["json"]["params"]["layers"] == [{"product": "MOD11A2.061", "layer": "LST_Night_1km"}]
            return httpx.Response(202, json={"task_id": "T1", "status": "pending"}, request=req)
        if url.endswith("/task/T1"):
            status = "processing" if state["pending"] > 0 else "done"
            state["pending"] -= 1
            return httpx.Response(200, json={"status": status}, request=req)
        if url.endswith("/bundle/T1"):
            return httpx.Response(200, json={"files": [{"file_name": "MOD11A2-061-Statistics.csv", "file_id": "F9"}]}, request=req)
        if url.endswith("/bundle/T1/F9"):
            return httpx.Response(200, text=STATS, request=req)
        raise AssertionError(url)

    monkeypatch.setattr("app.providers.appeears.httpx.post", post)
    monkeypatch.setattr("app.providers.appeears.httpx.request", request)
    return state


def test_task_lifecycle_pending_then_cached(settings, fake_appeears):
    logged_in = settings.model_copy(update={"earthdata_username": "student", "earthdata_password": "secret",
                                            "appeears_wait": 0, "appeears_poll": 0})
    provider = create_provider("appeears", logged_in)
    lst = Catalog.from_dir().get("modis_lst_night")

    with pytest.raises(TaskPending, match="preparing this area"):  # first request: submitted, still processing
        provider.fetch(lst, PHOENIX, dt.date(2001, 1, 1), dt.date(2001, 12, 31))
    series = provider.fetch(lst, PHOENIX, dt.date(2001, 1, 1), dt.date(2001, 12, 31))  # same task, now done
    assert fake_appeears["submitted"] == 1
    assert len(series) == 12
    assert series.iloc[0] == pytest.approx((280.0 + 282.0) / 2 - 273.15)  # month mean, K -> °C
    assert series.iloc[1] == pytest.approx(290.0 - 273.15) and series.iloc[2:].isna().all()

    # cached: a new provider without any login answers without calling AppEEARS
    fake_appeears["calls"].clear()
    again = create_provider("appeears", settings).fetch(lst, PHOENIX, dt.date(2001, 1, 1), dt.date(2001, 6, 30))
    assert fake_appeears["calls"] == [] and len(again) == 6


def test_without_login_an_uncached_area_is_an_error(settings):
    lst = Catalog.from_dir().get("modis_lst_night")
    with pytest.raises(ProviderError, match="Earthdata login"):
        create_provider("appeears", settings).fetch(lst, PHOENIX, dt.date(2001, 1, 1), dt.date(2005, 12, 31))
