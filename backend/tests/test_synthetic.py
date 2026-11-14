import datetime as dt

import numpy as np
import pandas as pd

from app.catalog import Catalog
from app.processing import preprocess as prep
from app.processing import trends
from app.processing.timeseries import decimal_years
from app.providers.synthetic import SyntheticProvider, trend_per_year
from app.schemas import BBox

CATALOG = Catalog.from_dir()
PUNJAB = BBox(west=73.5, south=28.5, east=77.5, north=32.5)
DELHI = BBox(west=76.8, south=28.3, east=77.6, north=28.9)
NORTH_CHINA = BBox(west=113, south=34, east=119, north=40)
INDIA_COAL = BBox(west=81, south=21.5, east=85, north=25.5)
EUROPE = BBox(west=0, south=45, east=10, north=52)
AMAZON = BBox(west=-70, south=-12, east=-50, north=0)


def fetch(var_id: str, bbox: BBox | None, start="2005-01-01", end="2020-12-31") -> pd.Series:
    variable = CATALOG.get(var_id)
    return SyntheticProvider().fetch(variable, bbox, dt.date.fromisoformat(start), dt.date.fromisoformat(end))


def trend(series: pd.Series) -> trends.TrendAnalysis:
    anomalies = prep.deseasonalize(series.interpolate(limit_area="inside"))
    return trends.analyze(decimal_years(anomalies.index), anomalies.to_numpy(), reference_mean=float(series.mean()))


def test_deterministic_per_request():
    a, b = fetch("gldas_gws", PUNJAB), fetch("gldas_gws", PUNJAB)
    assert a.equals(b)
    assert not a.equals(fetch("gldas_gws", EUROPE))
    assert fetch("mauna_loa_co2", None).equals(fetch("mauna_loa_co2", PUNJAB))  # series ignore the bbox


def test_changing_dates_is_a_window_on_the_same_series():
    long, short = fetch("merra2_so2", NORTH_CHINA, "1980-01-01", "2025-12-31"), fetch("merra2_so2", NORTH_CHINA)
    assert np.allclose(long.loc[short.index], short, equal_nan=True)


def test_every_variable_has_realistic_monthly_values():
    for variable in CATALOG.variables():
        box = None if variable.is_series else DELHI
        s = SyntheticProvider().fetch(variable, box, variable.available_start, variable.available_end)
        assert s.index.freqstr == "MS" and s.index[0] == pd.Timestamp(variable.available_start)
        assert s.notna().mean() > 0.95, variable.id
        hints = variable.synthetic
        assert hints.min <= s.min() and s.max() <= hints.max, variable.id
    lst = fetch("modis_lst_night", BBox(west=-112.5, south=33.2, east=-111.6, north=33.8))
    assert 0 < lst.min() and lst.max() < 40  # °C, not Kelvin
    assert (fetch("gpm_precipitation", PUNJAB).dropna() >= 0).all()


def test_seasonal_cycle_is_opposite_in_hemispheres():
    north = fetch("modis_lst_day", BBox(west=0, south=40, east=10, north=50))
    south = fetch("modis_lst_day", BBox(west=140, south=-35, east=150, north=-25))
    assert north[north.index.month == 7].mean() > north[north.index.month == 1].mean()
    assert south[south.index.month == 1].mean() > south[south.index.month == 7].mean()


def test_trends_can_have_opposite_signs_between_regions():
    hints = CATALOG.get("gpm_precipitation").synthetic
    signs = {np.sign(trend_per_year(hints, "gpm_precipitation", lat, lon))
             for lat in range(-60, 61, 20) for lon in range(-180, 180, 30)}
    assert signs >= {-1.0, 1.0}


def test_punjab_groundwater_falls_while_rain_is_flat():
    gws = trend(fetch("gldas_gws", PUNJAB, "2003-02-01", "2025-12-31"))
    assert gws.stats["significant"] and -20 <= gws.stats["slope_per_year"] <= -12  # mm/yr
    rain = trend(fetch("gpm_precipitation", PUNJAB, "2003-02-01", "2025-12-31"))
    assert not rain.stats["significant"]
    elsewhere = trend(fetch("gldas_gws", EUROPE, "2003-02-01", "2025-12-31"))
    assert abs(elsewhere.stats["slope_per_year"]) < 2


def test_coal_pollution_china_falls_after_2010_india_rises():
    for var_id in ("merra2_so2", "merra2_so4"):
        china = trend(fetch(var_id, NORTH_CHINA, "2010-01-01", "2025-12-31")).stats
        india = trend(fetch(var_id, INDIA_COAL, "2000-01-01", "2025-12-31")).stats
        assert china["direction"] == "falling" and china["significant"], var_id
        assert india["direction"] == "rising" and india["significant"], var_id


def test_no2_falls_in_western_cities_and_rises_in_delhi():
    new_york = trend(fetch("omi_no2", BBox(west=-74.6, south=40.1, east=-73.4, north=41.3), "2011-01-01", "2025-12-31"))
    beijing = trend(fetch("omi_no2", BBox(west=115.8, south=39.3, east=117.0, north=40.5), "2011-01-01", "2025-12-31"))
    delhi = trend(fetch("omi_no2", DELHI, "2005-01-01", "2025-12-31"))
    assert new_york.stats["direction"] == beijing.stats["direction"] == "falling"
    assert delhi.stats["direction"] == "rising" and delhi.stats["significant"]


def test_no2_lockdown_dip_in_spring_2020():
    s = fetch("omi_no2", DELHI, "2018-01-01", "2021-12-31")
    spring = lambda year: s[f"{year}-03":f"{year}-05"].mean()  # noqa: E731
    assert spring(2020) < 0.85 * min(spring(2019), spring(2021))


def test_dust_peaks_in_northern_summer_over_the_sahara():
    s = fetch("merra2_dust", BBox(west=1, south=16, east=9, north=24), "1990-01-01", "2020-12-31")
    climatology = s.groupby(s.index.month).mean()
    assert climatology.idxmax() in (5, 6, 7) and climatology.max() > 100  # µg/m³


def test_keeling_curve():
    co2 = fetch("mauna_loa_co2", None, "1958-03-01", "2024-10-31")
    assert 313 < co2["1958"].mean() < 318 and 420 < co2["2024"].mean() < 427
    assert co2.groupby(co2.index.month).mean().idxmax() == 5
    annual = co2.resample("YS").mean()
    early, late = annual["1960":"1970"].diff().mean(), annual["2010":"2020"].diff().mean()
    assert late > 2 * early  # accelerating (≈ quadratic) rise


def test_methane_plateau_then_renewed_growth():
    ch4 = fetch("noaa_ch4_marine", None, "1983-07-01", "2025-12-31").resample("YS").mean()
    assert 1615 < ch4.iloc[0] < 1640 and 1915 < ch4["2025"].iloc[0] < 1950
    plateau = ch4["2000":"2006"].iloc[-1] - ch4["2000":"2006"].iloc[0]
    renewed = ch4["2014":"2020"].iloc[-1] - ch4["2014":"2020"].iloc[0]
    assert abs(plateau) < 10 and renewed > 40


def test_unit_conversions_for_real_providers():
    assert CATALOG.get("modis_lst_day").to_catalog_units(300.0) == 300.0 - 273.15
    assert np.isclose(CATALOG.get("merra2_so2").to_catalog_units(5e-9), 5.0)  # kg/m³ -> µg/m³
    assert np.isclose(CATALOG.get("omi_no2").to_catalog_units(3e15), 3.0)
    assert CATALOG.get("gpm_precipitation").to_catalog_units(0.1) == 0.1 * 24
    assert CATALOG.get("gldas_gws").to_catalog_units(42.0) == 42.0
