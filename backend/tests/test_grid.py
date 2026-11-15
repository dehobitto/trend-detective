import datetime as dt

import numpy as np
import pandas as pd
import pytest

from app.catalog import Catalog
from app.grid import GridService
from app.grid.service import MAX_CELLS, grid_shape
from app.processing.timeseries import area_mean
from app.providers.synthetic import generate
from app.schemas import BBox

PUNJAB = {"west": 73, "south": 28, "east": 78, "north": 32}
PACIFIC = {"west": -160, "south": -10, "east": -140, "north": 10}


@pytest.fixture(scope="module")
def grid() -> GridService:
    return GridService(Catalog.from_dir())


def test_frame_shape_and_contract(client):
    r = client.get("/api/grid/merra2_dust", params={"date": "2010-07-01"} | PUNJAB)
    assert r.status_code == 200, r.text
    f = r.json()
    assert set(f) == {"variable_id", "date", "bbox", "width", "height", "values", "min", "max", "units", "colormap",
                      "synthetic"}
    assert f["variable_id"] == "merra2_dust" and f["date"] == "2010-07-01" and f["synthetic"] is True
    assert f["bbox"] == PUNJAB and f["units"] == "µg/m³"
    assert len(f["values"]) == f["width"] * f["height"] and f["width"] > f["height"]
    assert all(v is not None for v in f["values"])  # global variable: no gaps
    stops = f["colormap"]["stops"]
    assert 6 <= len(stops) <= 9 and stops[0][0] == f["min"] and stops[-1][0] == f["max"] and f["min"] < f["max"]
    assert all(c.startswith("#") and len(c) == 7 for _, c in stops)


def test_default_is_global_and_size_is_capped(client):
    f = client.get("/api/grid/gpm_precipitation", params={"date": "2010-07-15"}).json()
    assert f["date"] == "2010-07-01"  # any day picks its month
    assert f["bbox"] == {"west": -180, "south": -90, "east": 180, "north": 90}
    assert f["width"] <= MAX_CELLS and f["height"] <= MAX_CELLS and f["width"] == 2 * f["height"]
    tiny = client.get("/api/grid/gpm_precipitation", params={"date": "2010-07-01", "res": 0.001} | PUNJAB).json()
    assert (tiny["width"], tiny["height"]) == (MAX_CELLS, MAX_CELLS)
    assert grid_shape(BBox(**PUNJAB), 1.0) == (5, 4)
    assert grid_shape(BBox(**PUNJAB), None) == (50, 40)  # default never finer than 0.1°


def test_land_variables_are_null_over_the_ocean(client):
    ocean = client.get("/api/grid/modis_lst_day", params={"date": "2010-07-01"} | PACIFIC).json()
    assert all(v is None for v in ocean["values"])
    land = client.get("/api/grid/modis_lst_day", params={"date": "2010-07-01"} | PUNJAB).json()
    assert all(v is not None for v in land["values"])
    world = client.get("/api/grid/gldas_gws", params={"date": "2010-07-01"}).json()
    share_null = sum(v is None for v in world["values"]) / len(world["values"])
    assert 0.55 < share_null < 0.8  # ~2/3 of the globe is water
    sea = client.get("/api/grid/omi_no2", params={"date": "2010-07-01"} | PACIFIC).json()
    assert all(v is not None for v in sea["values"])  # global variables cover the ocean


def test_frames_are_deterministic_and_independent_of_the_view(grid):
    a = grid.frame("omi_no2", dt.date(2012, 1, 1), BBox(**PUNJAB), 0.5)
    grid._frame_json.cache_clear()
    b = grid.frame("omi_no2", dt.date(2012, 1, 1), BBox(**PUNJAB), 0.5)
    assert a == b
    # The same cell from a larger view has the same value (noise does not depend on the requested bbox).
    big = grid.frame("omi_no2", dt.date(2012, 1, 1), BBox(west=70, south=28, east=78, north=36), 0.5)
    assert big["values"][8 * big["width"] + 6] == a["values"][0]  # 32.0-31.5°N, 73.0-73.5°E


def test_color_range_is_stable(grid):
    frames = [grid.frame("modis_lst_day", dt.date(y, m, 1), BBox(**b)) for y, m in [(2001, 1), (2020, 7)]
              for b in (PUNJAB, PACIFIC)]
    assert len({(f["min"], f["max"]) for f in frames}) == 1
    assert len({str(f["colormap"]) for f in frames}) == 1
    lo, hi = grid.value_range("modis_lst_day")
    assert -60 < lo < 0 < 25 < hi < 60
    lo, hi = grid.value_range("omi_no2")
    assert 0 <= lo < 1 and hi > 5  # wide enough for Beijing/Delhi to stay readable


def _frame_mean(grid, var, bbox, month):
    f = grid.frame(var, month, BBox(**bbox), 0.25)
    v = np.array([np.nan if x is None else x for x in f["values"]], dtype=float).reshape(f["height"], f["width"])
    lats = np.linspace(bbox["north"], bbox["south"], f["height"] + 1)
    lats = (lats[:-1] + lats[1:]) / 2
    return float(area_mean(v[None], lats)[0])


@pytest.mark.parametrize("var, bbox", [("gldas_gws", PUNJAB), ("omi_no2", {"west": 114, "south": 37, "east": 119,
                                                                             "north": 42})])
def test_frames_tell_the_same_story_as_the_area_series(grid, var, bbox):
    variable = grid.catalog.get(var)
    series = generate(variable, BBox(**bbox))
    years = [2006, 2010, 2014, 2018] if var == "gldas_gws" else [2008, 2011, 2016, 2019]
    frame_means, series_means = [], []
    for y in years:
        months = [dt.date(y, m, 1) for m in range(1, 13)]
        frame_means.append(np.mean([_frame_mean(grid, var, bbox, m) for m in months]))
        series_means.append(series.loc[f"{y}-01-01":f"{y}-12-31"].mean())
    frame_means, series_means = np.array(frame_means), np.array(series_means)
    spread = np.ptp(series_means)
    # Annual means agree to within noise, and the frames follow the series' trajectory.
    assert np.max(np.abs(frame_means - series_means)) < 0.25 * spread + 3 * variable.synthetic.noise
    assert np.corrcoef(frame_means, series_means)[0, 1] > 0.9


def test_seasonality_matches_the_series(grid):
    variable = grid.catalog.get("modis_lst_day")
    series = generate(variable, BBox(**PUNJAB))
    jan = _frame_mean(grid, "modis_lst_day", PUNJAB, dt.date(2015, 1, 1))
    jun = _frame_mean(grid, "modis_lst_day", PUNJAB, dt.date(2015, 6, 1))
    assert jun - jan > 10
    assert abs(jan - series[pd.Timestamp("2015-01-01")]) < 5 and abs(jun - series[pd.Timestamp("2015-06-01")]) < 5


def test_dates(client):
    dates = client.get("/api/grid/omi_no2/dates").json()
    assert dates[0] == "2004-10-01" and dates[-1] == "2025-12-01"
    assert len(dates) == len(set(dates)) == (2025 - 2004) * 12 + 3
    assert all(d.endswith("-01") for d in dates)


def test_errors(client):
    r = client.get("/api/grid/noaa_ch4_marine", params={"date": "2010-01-01"})
    assert r.status_code == 404 and "series" in r.json()["detail"]
    assert client.get("/api/grid/mauna_loa_co2/dates").status_code == 404
    assert client.get("/api/grid/nope", params={"date": "2010-01-01"}).status_code == 404
    r = client.get("/api/grid/omi_no2", params={"date": "1990-01-01"})
    assert r.status_code == 422 and "2004-10" in r.json()["detail"]
    assert client.get("/api/grid/omi_no2").status_code == 422  # date is required
    r = client.get("/api/grid/omi_no2", params={"date": "2010-01-01", "west": 10, "east": 20})
    assert r.status_code == 422 and "north" in r.json()["detail"]
    r = client.get("/api/grid/omi_no2", params={"date": "2010-01-01", "west": 20, "south": 0, "east": 10, "north": 5})
    assert r.status_code == 422 and "West must be smaller" in r.json()["detail"]


# ------------------------------------------------------------------ v3: anomaly and trend maps

def _arr(values):
    return np.array([np.nan if x is None else x for x in values], dtype=float)


def test_anomaly_frame_contract_and_symmetric_range(client):
    r = client.get("/api/grid/modis_lst_day", params={"date": "2015-07-01", "mode": "anomaly"} | PUNJAB)
    assert r.status_code == 200, r.text
    f = r.json()
    assert f["date"] == "2015-07-01" and f["units"] == "°C" and f["colormap"]["name"] == "diverging"
    assert len(f["values"]) == f["width"] * f["height"]
    assert f["min"] == -f["max"] and f["max"] > 0
    stops = f["colormap"]["stops"]
    assert stops[0] == [f["min"], "#07668A"] and stops[-1] == [f["max"], "#9A5200"]
    assert [0.0, "#F2F4F5"] in stops
    other = client.get("/api/grid/modis_lst_day", params={"date": "2003-01-01", "mode": "anomaly"}).json()
    assert (other["min"], other["max"]) == (f["min"], f["max"])  # stable per variable
    assert client.get("/api/grid/modis_lst_day", params={"date": "2015-07-01", "mode": "nope"}).status_code == 422


def test_anomalies_average_to_zero(grid):
    # Each calendar month's anomaly averages to ~0 over the record; over one year the global mean is small.
    variable = grid.catalog.get("gpm_precipitation")
    r = grid.anomaly_range("gpm_precipitation")
    lats = np.linspace(90, -90, 46)
    lats = (lats[:-1] + lats[1:]) / 2
    means = []
    for m in range(1, 13):
        f = grid.frame("gpm_precipitation", dt.date(2012, m, 1), res=4.0, mode="anomaly")
        means.append(area_mean(_arr(f["values"]).reshape(f["height"], f["width"])[None], lats)[0])
    assert abs(np.mean(means)) < 0.1 * r
    # And the value frame minus the anomaly frame is the same climatology every year.
    a = [grid.frame("gpm_precipitation", dt.date(y, 7, 1), BBox(**PUNJAB), 1.0) for y in (2005, 2015)]
    b = [grid.frame("gpm_precipitation", dt.date(y, 7, 1), BBox(**PUNJAB), 1.0, mode="anomaly") for y in (2005, 2015)]
    clim = [_arr(x["values"]) - _arr(y["values"]) for x, y in zip(a, b)]
    assert np.allclose(clim[0], clim[1], atol=1e-3)
    assert variable.units == a[0]["units"]


def test_trend_contract_and_default_global_resolution(client):
    r = client.get("/api/grid/gpm_precipitation/trend", params={"start": "2001-01-01", "end": "2024-12-01"})
    assert r.status_code == 200, r.text
    f = r.json()
    assert set(f) == {"variable_id", "date", "bbox", "width", "height", "values", "min", "max", "units", "colormap",
                      "synthetic", "start", "end", "significant"}
    assert (f["width"], f["height"]) == (180, 90)
    assert f["date"] == f["end"] == "2024-12-01" and f["start"] == "2001-01-01"
    assert f["units"] == "mm/day per decade" and f["min"] == -f["max"] > -1e9
    assert len(f["values"]) == len(f["significant"]) == 180 * 90
    assert all(isinstance(s, bool) for s in f["significant"])
    land = client.get("/api/grid/gldas_gws/trend", params={"start": "2004-01-01", "end": "2024-12-01"} | PACIFIC).json()
    assert all(v is None for v in land["values"]) and all(s is None for s in land["significant"])


def _cell(f, lat, lon):
    b = f["bbox"]
    row = int((b["north"] - lat) / (b["north"] - b["south"]) * f["height"])
    col = int((lon - b["west"]) / (b["east"] - b["west"]) * f["width"])
    i = row * f["width"] + col
    return f["values"][i], f["significant"][i]


def test_trend_hotspots(grid):
    gws = grid.trend("gldas_gws", dt.date(2004, 1, 1), dt.date(2024, 12, 1))
    slope, sig = _cell(gws, 30.0, 75.5)
    assert slope < -100 and sig is True  # Punjab groundwater depletion: ~-180 mm per decade
    rain = grid.trend("gpm_precipitation", dt.date(2001, 1, 1), dt.date(2024, 12, 1))
    slope, sig = _cell(rain, 30.0, 75.5)
    assert sig is False and abs(slope) < rain["max"] / 2  # ... while Punjab rainfall has no trend
    amazon, sig = _cell(rain, -6, -60)
    assert amazon < 0 and sig is True
    # Regional request at its own resolution agrees with the global map.
    regional = grid.trend("gldas_gws", dt.date(2004, 1, 1), dt.date(2024, 12, 1), BBox(**PUNJAB), 1.0)
    assert (regional["width"], regional["height"]) == (5, 4)
    assert all(v is not None and v < 0 for v in regional["values"])


def test_trend_errors_and_clamping(client):
    p = {"start": "2010-01-01", "end": "2011-06-01"}
    r = client.get("/api/grid/gldas_gws/trend", params=p)
    assert r.status_code == 422 and "3 years" in r.json()["detail"]
    assert client.get("/api/grid/mauna_loa_co2/trend", params={"start": "2000-01-01", "end": "2020-01-01"}).status_code == 404
    r = client.get("/api/grid/omi_no2/trend", params={"start": "1990-01-01", "end": "2010-01-01"})
    assert r.status_code == 200 and r.json()["start"] == "2004-10-01"  # clamped to availability
    assert client.get("/api/grid/omi_no2/trend", params={"start": "2010-01-01", "end": "2005-01-01"}).status_code == 422


def test_trend_is_fast(grid):
    import time

    grid.trend_range("modis_lst_day")
    t = time.perf_counter()
    grid.trend("modis_lst_day", dt.date(2001, 1, 1), dt.date(2024, 12, 1))
    assert time.perf_counter() - t < 1.5
    t = time.perf_counter()
    grid.trend("modis_lst_day", dt.date(2001, 1, 1), dt.date(2024, 12, 1))
    assert time.perf_counter() - t < 0.05  # cached
