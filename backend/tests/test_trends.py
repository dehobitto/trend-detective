import numpy as np
import pytest
from scipy import stats as sps

from app.processing import trends


def test_ols_recovers_known_slope():
    rng = np.random.default_rng(0)
    t = np.arange(0, 30, 1 / 12)
    y = 5 + 0.03 * t + rng.normal(0, 0.2, t.size)
    fit = trends.ols(t, y)
    assert fit.slope == pytest.approx(0.03, abs=0.003)
    assert fit.intercept == pytest.approx(5, abs=0.1)
    assert fit.slope_ci[0] < 0.03 < fit.slope_ci[1]
    assert fit.p_value < 1e-6


def test_ols_matches_scipy_linregress():
    rng = np.random.default_rng(1)
    t = np.linspace(0, 10, 50)
    y = 2 - 0.5 * t + rng.normal(0, 1, t.size)
    fit = trends.ols(t, y)
    ref = sps.linregress(t, y)
    assert fit.slope == pytest.approx(ref.slope)
    assert fit.p_value == pytest.approx(ref.pvalue)
    assert fit.r_squared == pytest.approx(ref.rvalue**2)
    assert fit.slope_se == pytest.approx(ref.stderr)


def test_ci_band_contains_fit_and_is_narrowest_at_center():
    t = np.arange(40, dtype=float)
    y = t * 0.1 + np.sin(t)
    fit = trends.ols(t, y)
    lo, hi = fit.mean_ci(t)
    assert np.all(lo < fit.predict(t)) and np.all(hi > fit.predict(t))
    width = hi - lo
    assert np.argmin(width) in (19, 20)


def test_ols_ignores_nans():
    t = np.arange(10, dtype=float)
    y = 2 * t
    y[3] = np.nan
    assert trends.ols(t, y).slope == pytest.approx(2)


def test_mann_kendall_detects_monotonic_trend():
    y = np.arange(20, dtype=float) ** 1.5  # monotonic but non-linear
    mk = trends.mann_kendall(y)
    assert mk.tau == pytest.approx(1.0)
    assert mk.s == 190
    assert mk.var_s == pytest.approx(20 * 19 * 45 / 18)
    assert mk.p_value < 1e-6
    assert trends.mann_kendall(-y).z < 0


def test_mann_kendall_white_noise_rarely_significant():
    rng = np.random.default_rng(42)
    rejections = sum(trends.mann_kendall(rng.normal(size=60)).p_value < 0.05 for _ in range(200))
    assert rejections / 200 < 0.1  # nominal rate is 5%


def test_mann_kendall_tie_correction():
    y = np.array([1, 1, 2, 2, 2, 3, 3, 4, 4, 4], dtype=float)
    mk = trends.mann_kendall(y)
    n = len(y)
    # tie groups: sizes 2, 3, 2, 3
    tie = sum(t * (t - 1) * (2 * t + 5) for t in (2, 3, 2, 3))
    assert mk.var_s == pytest.approx((n * (n - 1) * (2 * n + 5) - tie) / 18)
    assert mk.s == 37  # 45 pairs minus 8 tied pairs, all others increasing
    assert mk.p_value < 0.01


def test_mann_kendall_all_ties_is_no_trend():
    mk = trends.mann_kendall(np.ones(10))
    assert mk.s == 0 and mk.z == 0 and mk.p_value == 1.0


def test_sens_slope_is_robust_to_outliers():
    t = np.arange(20, dtype=float)
    y = 0.5 * t
    y[5] = 100
    assert trends.sens_slope(t, y) == pytest.approx(0.5)
    assert trends.ols(t, y).slope != pytest.approx(0.5)


def test_analyze_packages_stats_per_decade_and_direction():
    rng = np.random.default_rng(3)
    t = 1990 + np.arange(0, 25, 1 / 12)
    y = 10 - 0.02 * (t - 1990) + rng.normal(0, 0.05, t.size)
    out = trends.analyze(t, y, alpha=0.05, reference_mean=10.0)
    s = out.stats
    assert s["slope_per_decade"] == pytest.approx(-0.2, abs=0.02)
    assert s["sens_slope_per_decade"] == pytest.approx(-0.2, abs=0.02)
    assert s["direction"] == "falling"
    assert s["significant"] is True
    assert s["percent_change"] == pytest.approx(s["total_change"] / 10 * 100)
    assert s["intercept"] == pytest.approx(10, abs=0.05)  # intercept is at the first time step
    assert len(out.trend) == len(out.ci_low) == len(out.ci_high) == t.size


def test_analyze_flat_and_not_significant_on_noise():
    rng = np.random.default_rng(5)
    y = rng.normal(0, 1, 120)
    out = trends.analyze(np.arange(120) / 12, y, ratio_scale=False)
    assert out.stats["percent_change"] is None
    assert out.stats["significant"] is False


def test_lag1_autocorrelation():
    rng = np.random.default_rng(9)
    x = np.zeros(2000)
    for i in range(1, x.size):
        x[i] = 0.8 * x[i - 1] + rng.normal()
    assert trends.lag1_autocorrelation(x) == pytest.approx(0.8, abs=0.05)


@pytest.mark.filterwarnings("ignore::RuntimeWarning")
def test_ols_rejects_overflowing_values_instead_of_returning_nan():
    with pytest.raises(ValueError, match="too large"):
        trends.ols(np.arange(6.0), np.array([1e308, -1e308, 1e308, 1e308, 1e308, 1.0]))
