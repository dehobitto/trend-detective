import numpy as np
import pandas as pd
import pytest

from app.processing import preprocess, timeseries
from app.processing.summary import build_summary, format_number
from app.schemas import TrendStats


def test_area_mean_weights_by_latitude_and_ignores_nans():
    lats = np.array([0.0, 60.0])
    cube = np.array([[[1.0, 1.0], [4.0, np.nan]]])  # one time step
    # weights: cos(0)=1 (x2 cells), cos(60)=0.5 (x1 valid cell)
    assert timeseries.area_mean(cube, lats)[0] == pytest.approx((1 + 1 + 0.5 * 4) / 2.5)


def test_resample_monthly_and_annual():
    idx = pd.date_range("2000-01-01", "2001-12-31", freq="D")
    s = pd.Series(1.0, index=idx)
    monthly = timeseries.to_monthly(s)
    assert len(monthly) == 24 and monthly.index[0] == pd.Timestamp("2000-01-01")
    annual = timeseries.to_annual(monthly)
    assert list(annual.index.year) == [2000, 2001]


def test_fill_gaps_only_short_interior_gaps():
    s = pd.Series([np.nan, 1, np.nan, 3, np.nan, np.nan, np.nan, 7], dtype=float)
    filled, n = preprocess.fill_gaps(s, max_gap=2)
    assert n == 1
    assert filled.iloc[2] == pytest.approx(2)
    assert filled.iloc[4:7].isna().all() and np.isnan(filled.iloc[0])


def test_deseasonalize_removes_cycle():
    idx = pd.date_range("2000-01-01", periods=120, freq="MS")
    s = pd.Series(10 + 5 * np.sin(2 * np.pi * idx.month / 12), index=idx)
    anomalies = preprocess.deseasonalize(s)
    assert np.allclose(anomalies, 0)


def _stats(**kw) -> TrendStats:
    base = dict(n=100, slope_per_year=0.042, slope_per_decade=0.42, slope_ci_low_per_decade=0.3,
                slope_ci_high_per_decade=0.5, intercept=0, r_squared=0.5, t_stat=5, p_value=0.0001,
                mk_tau=0.4, mk_z=5, mk_p_value=0.0002, sens_slope_per_decade=0.41, total_change=1.8,
                percent_change=None, direction="rising", significant=True, alpha=0.05)
    return TrendStats(**(base | kw))


def test_summary_texts():
    assert build_summary(_stats(), "°C", 1980, 2023).startswith("Rising by 0.42 °C per decade")
    assert "Both tests agree" in build_summary(_stats(), "°C", 1980, 2023)
    not_sig = _stats(p_value=0.3, mk_p_value=0.4, significant=False)
    assert "not statistically significant" in build_summary(not_sig, "°C", 1980, 2023)
    mixed = _stats(p_value=0.01, mk_p_value=0.2, significant=False)
    assert "Only the regression" in build_summary(mixed, "°C", 1980, 2023)
    assert "per decade (+" in build_summary(_stats(), "unitless", 2000, 2020)
    assert format_number(0.000123) == "0.00012" and format_number(1234.5) == "1,200"
