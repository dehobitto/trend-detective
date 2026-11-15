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


def _trend_plus_cycle(years: int = 20, slope: float = 0.5) -> tuple[pd.Series, np.ndarray]:
    idx = pd.date_range("2000-01-01", periods=years * 12, freq="MS")
    cycle = 3 * np.sin(2 * np.pi * (idx.month - 1) / 12) + np.cos(4 * np.pi * (idx.month - 1) / 12)
    t = np.arange(len(idx)) / 12
    return pd.Series(10 + slope * t + cycle, index=idx), cycle.to_numpy()[:12]


def test_seasonal_cycle_is_not_skewed_by_the_trend():
    s, true_cycle = _trend_plus_cycle()
    cycle = preprocess.seasonal_cycle(s)
    assert list(cycle.index) == list(range(1, 13))
    assert np.allclose(cycle.to_numpy(), true_cycle - true_cycle.mean(), atol=1e-9)
    # Raw monthly means would read December ~0.23 too high and January ~0.23 too low here.
    raw_means = s.groupby(s.index.month).mean()
    assert abs((raw_means - raw_means.mean()).iloc[11] - cycle.iloc[11]) > 0.2


def test_preprocess_components_add_up_and_keep_the_slope():
    s, _ = _trend_plus_cycle(slope=-0.8)
    s.iloc[[30, 31, 100]] = np.nan
    out = preprocess.preprocess(s, want_deseasonalized=True, is_monthly=True)
    assert out.seasonal is not None and out.deseasonalized is not None
    assert np.allclose(out.raw, out.raw.mean() + out.seasonal + out.deseasonalized)
    assert abs(out.deseasonalized.mean()) < 1e-9  # anomalies stay centered on 0
    t = np.arange(len(s)) / 12
    assert np.polyfit(t, out.deseasonalized.to_numpy(), 1)[0] == pytest.approx(-0.8, abs=0.01)


def test_seasonal_cycle_short_or_cycle_free_records():
    two_years, _ = _trend_plus_cycle(years=2)
    cycle = preprocess.seasonal_cycle(two_years)  # too short to detrend: raw monthly means
    assert cycle.notna().all() and cycle.sum() == pytest.approx(0, abs=1e-9)
    annual = pd.Series([1.0, 2.0, 3.0], index=pd.date_range("2000-01-01", periods=3, freq="YS"))
    assert (preprocess.seasonal_cycle(annual) == 0).all()
    out = preprocess.preprocess(annual, want_deseasonalized=False, is_monthly=True)
    assert out.seasonal is None and out.deseasonalized is None


def _stats(**kw) -> TrendStats:
    base = dict(n=100, slope_per_year=0.042, slope_per_decade=0.42, slope_ci_low_per_decade=0.3,
                slope_ci_high_per_decade=0.5, intercept=0, r_squared=0.5,
                mk_tau=0.4, mk_z=5, mk_p_value=0.0002, total_change=1.8,
                percent_change=None, direction="rising", significant=True, alpha=0.05)
    return TrendStats(**(base | kw))


def test_summary_texts():
    assert build_summary(_stats(), "°C", 1980, 2023).startswith("Rising by 0.42 °C per decade")
    assert "Mann-Kendall test confirms" in build_summary(_stats(), "°C", 1980, 2023)
    not_sig = _stats(mk_p_value=0.4, significant=False)
    assert "not statistically significant" in build_summary(not_sig, "°C", 1980, 2023)
    assert "per decade (+" in build_summary(_stats(), "unitless", 2000, 2020)
    assert format_number(0.000123) == "0.00012" and format_number(1234.5) == "1,200"


def test_preprocess_blanks_interpolated_values_for_testing():
    idx = pd.date_range("2000-01-01", periods=6, freq="MS")
    s = pd.Series([1.0, np.nan, 3.0, 4.0, np.nan, 6.0], index=idx)
    out = preprocess.preprocess(s, want_deseasonalized=False, is_monthly=True)
    assert out.raw.notna().all()  # chart still shows the filled values
    assert out.tested.isna().tolist() == [False, True, False, False, True, False]
