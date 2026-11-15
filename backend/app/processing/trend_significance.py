#!/usr/bin/env python3
"""
trend_significance.py: stage 3, significance testing of a time-series trend.

The module diagnoses the series itself and does not depend on the methods used in stages 1 and 2:
  1. Builds a "passport" of the series (length, gaps, autocorrelation, unit root,
     long memory, heteroscedasticity, residual seasonality, structural breaks).
  2. Picks the trend tests that suit that passport (parametric, nonparametric,
     autocorrelation-robust) and runs ALL of them, not just one convenient test.
  3. Runs robustness checks (block bootstrap, surrogates, window shifts, outliers).
  4. Estimates practical significance and statistical power.
  5. Returns a verdict: significant_up / significant_down / not_significant /
     ambiguous / insufficient_data, plus a confidence level and warnings.

Inputs:
    y        - the series AFTER seasonality removal (stage 1). pandas.Series or array.
    t        - time (numbers, datetime64, or the DatetimeIndex of y). The slope is per
               unit of t; for dates it is per year.
    seasonal - (optional) the seasonal component, used only to compare magnitudes.
    period   - (optional) seasonal period in samples: checks y for residual seasonality.
    trend_fn - (optional) function y -> trend (the stage 2 method). If given, it is
               tested too (surrogate test on the statistic "total change of the trend").

Usage:
    from trend_significance import assess_trend
    rep = assess_trend(y, period=12)
    print(rep.summary())
    rep.to_json("report.json")

CLI:
    python trend_significance.py data.csv --value col --time col [--period 12]
    python trend_significance.py --demo

Dependencies: numpy, scipy, statsmodels. Optional: pandas, pymannkendall
(Hamed-Rao); the CLI needs pandas.
"""
from __future__ import annotations

import argparse
import json
import math
import warnings
from dataclasses import asdict, dataclass, field
from typing import Callable, Optional

import numpy as np
import statsmodels.api as sm
from scipy import stats
from scipy.signal import lfilter
from statsmodels.stats.diagnostic import (acorr_ljungbox, het_breuschpagan,
                                          breaks_cusumolsresid)
from statsmodels.stats.stattools import durbin_watson, jarque_bera
from statsmodels.tsa.stattools import adfuller, kpss

try:  # optional dependency
    import pymannkendall as _pmk
except Exception:  # pragma: no cover
    _pmk = None

# ----------------------------------------------------------------------------
# Result structures
# ----------------------------------------------------------------------------


@dataclass
class TestResult:
    name: str
    family: str                      # parametric / nonparametric / robust / resampling / ...
    applicable: bool = True
    statistic: Optional[float] = None
    p_value: Optional[float] = None
    estimate: Optional[float] = None  # slope (per unit of time) or another estimate
    ci: Optional[tuple] = None
    direction: Optional[str] = None   # up / down / none
    significant: Optional[bool] = None
    voting: bool = True               # whether it counts toward the verdict
    note: str = ""


@dataclass
class Report:
    passport: dict
    tests: list
    effect: dict
    sensitivity: dict
    warnings: list
    verdict: str
    confidence: str
    rationale: str
    config: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return _jsonable(asdict(self))

    def to_json(self, path: Optional[str] = None, indent: int = 2) -> str:
        s = json.dumps(self.to_dict(), ensure_ascii=False, indent=indent)
        if path:
            with open(path, "w", encoding="utf-8") as f:
                f.write(s)
        return s

    def summary(self) -> str:
        L = []
        p = self.passport
        L.append("=" * 74)
        L.append(f"ВЕРДИКТ: {self.verdict}   (впевненість: {self.confidence})")
        L.append(f"Пояснення: {self.rationale}")
        L.append("=" * 74)
        L.append(f"n={p['n_valid']} (з {p['n_total']}), одиниця часу: {p['time_unit']}, "
                 f"регулярний крок: {p['regular']}, пропусків: {p['missing_frac']:.1%}")
        L.append(f"Автокореляція r1={p['r1']:.2f} (n_eff≈{p['n_eff']:.0f}), "
                 f"клас ряду: {p['stationarity_class']}, DFA α={_fmt(p.get('dfa_alpha'))}")
        L.append("-" * 74)
        L.append(f"{'Тест':<38}{'оцінка':>12}{'p':>11}  {'напр.':<6}{'знач.':<6}")
        for t in self.tests:
            if not t["applicable"]:
                L.append(f"{t['name']:<38}{'—':>12}{'—':>11}  (не застосовний: {t['note']})")
                continue
            star = "" if t["voting"] else " *"
            sig = {True: "так", False: "ні", None: "—"}[t["significant"]]
            ci = ""
            if t["ci"] is not None:
                ci = f" CI[{t['ci'][0]:.3g}; {t['ci'][1]:.3g}]"
            L.append(f"{(t['name'] + star):<38}{_fmt(t['estimate']):>12}{_pfmt(t['p_value']):>11}  "
                     f"{(t['direction'] or '—'):<6}{sig:<6}{ci}")
        L.append("  (* — довідково, у голосуванні не бере участі)")
        e = self.effect
        L.append("-" * 74)
        L.append(f"Нахил: {_fmt(e.get('slope'))} / {e['time_unit']};  повна зміна за період: "
                 f"{_fmt(e.get('total_change'))} ({_fmt(e.get('total_change_sigma'))}σ шуму"
                 + (f", {e['total_change_pct_of_mean']:.1f}% від середнього" if e.get('total_change_pct_of_mean') is not None else "")
                 + ")")
        if e.get("seasonal_amplitude") is not None:
            L.append(f"Амплітуда сезонності: {_fmt(e['seasonal_amplitude'])}; "
                     f"зміна тренду/амплітуда = {_fmt(e.get('change_to_seasonal_ratio'))}")
        L.append(f"Мінімальний виявлюваний нахил (потужність 80%): {_fmt(e.get('min_detectable_slope'))};  "
                 f"потрібно ≈{_fmt(e.get('n_needed'))} точок для виявлення спостережуваного нахилу")
        s = self.sensitivity
        if s:
            L.append(f"Стійкість: однаковий знак у {s['share_same_sign']:.0%} варіантів, "
                     f"значущий у {s['share_significant']:.0%} ({s['n_variants']} варіантів)")
        if self.warnings:
            L.append("-" * 74)
            L.append("ПОПЕРЕДЖЕННЯ:")
            for w in self.warnings:
                L.append(f"  • {w}")
        return "\n".join(L)


def _fmt(x) -> str:
    if x is None or (isinstance(x, float) and not np.isfinite(x)):
        return "—"
    if isinstance(x, (int, np.integer)):
        return str(x)
    return f"{x:.4g}"


def _pfmt(p) -> str:
    if p is None or (isinstance(p, float) and not np.isfinite(p)):
        return "—"
    return "<1e-16" if p < 1e-16 else f"{p:.3g}"


def _jsonable(o):
    if isinstance(o, dict):
        return {k: _jsonable(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_jsonable(v) for v in o]
    if isinstance(o, (np.floating, float)):
        return None if not np.isfinite(o) else float(o)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.bool_,)):
        return bool(o)
    return o


# ----------------------------------------------------------------------------
# Data preparation
# ----------------------------------------------------------------------------

def _prepare(y, t):
    """Return (y, t, pos, n_total, time_unit): sorted, NaN-free."""
    idx = None
    try:
        import pandas as pd
        if isinstance(y, pd.Series):
            idx = y.index
            y = y.to_numpy(dtype=float)
            if t is None and isinstance(idx, pd.DatetimeIndex):
                t = idx.to_numpy()
            elif t is None and pd.api.types.is_numeric_dtype(idx):
                t = np.asarray(idx, dtype=float)
    except ImportError:
        pass
    yv = np.asarray(y, dtype=float)
    n_total = len(yv)
    unit = "крок"
    if t is None:
        tv = np.arange(n_total, dtype=float)
    else:
        t = np.asarray(t)
        if np.issubdtype(t.dtype, np.datetime64):
            tv = (t - t[0]) / np.timedelta64(1, "s") / (365.25 * 86400.0)
            unit = "рік"
        else:
            tv = t.astype(float)
            unit = "од. t"
    if len(tv) != n_total:
        raise ValueError("y і t мають однакову довжину")
    pos = np.arange(n_total)
    ok = np.isfinite(yv) & np.isfinite(tv)
    yv, tv, pos = yv[ok], tv[ok], pos[ok]
    order = np.argsort(tv, kind="stable")
    yv, tv, pos = yv[order], tv[order], pos[order]
    if len(tv) > 1 and np.any(np.diff(tv) == 0):
        raise ValueError("Повторювані мітки часу: агрегуйте ряд перед аналізом")
    return yv, tv, pos, n_total, unit


# ----------------------------------------------------------------------------
# Core statistics: Sen, Mann-Kendall, TFPW
# ----------------------------------------------------------------------------

def _pair_slopes(y, t, max_pairs=2_000_000, seed=0):
    n = len(y)
    full = n * (n - 1) // 2 <= max_pairs
    if full:
        i, j = np.triu_indices(n, 1)
    else:
        rng = np.random.default_rng(seed)
        i = rng.integers(0, n, max_pairs)
        j = rng.integers(0, n, max_pairs)
        m = i != j
        i, j = i[m], j[m]
    dt = t[j] - t[i]
    nz = dt != 0
    return (y[j] - y[i])[nz] / dt[nz], full


def _sen_slope(y, t):
    s, _ = _pair_slopes(y, t)
    b = float(np.median(s))
    return b, float(np.median(y - b * t))


def _mk_core(y):
    """Statistic S, tie-corrected variance, Z, p-value, tau."""
    n = len(y)
    S = 0.0
    for k in range(n - 1):
        S += np.sign(y[k + 1:] - y[k]).sum()
    _, c = np.unique(y, return_counts=True)
    c = c[c > 1].astype(float)
    var = (n * (n - 1) * (2 * n + 5) - np.sum(c * (c - 1) * (2 * c + 5))) / 18.0
    z = 0.0 if S == 0 else (S - np.sign(S)) / math.sqrt(var)
    p = 2 * (1 - stats.norm.cdf(abs(z)))
    tau = S / (n * (n - 1) / 2)
    return S, var, z, p, tau


def _lag1(x):
    x = x - x.mean()
    d = np.sum(x * x)
    return float(np.sum(x[:-1] * x[1:]) / d) if d > 0 else 0.0


def _tfpw_mk(y, alpha):
    """Trend-Free Pre-Whitening (Yue et al., 2002) + Mann-Kendall. Time axis = step index."""
    n = len(y)
    idx = np.arange(n, dtype=float)
    b, _ = _sen_slope(y, idx)
    x = y - b * idx
    r1 = _lag1(x)
    thr = 1.96 / math.sqrt(n)
    if abs(r1) <= thr:  # autocorrelation not significant: plain MK
        S, var, z, p, tau = _mk_core(y)
        return z, p, r1, False
    w = x[1:] - r1 * x[:-1]
    y2 = w + b * idx[1:]
    S, var, z, p, tau = _mk_core(y2)
    return z, p, r1, True


def _ols_slope_vec(Y, tc, sxx):
    return (Y @ tc) / sxx


def _direction(b, sig):
    if not sig or b is None or not np.isfinite(b):
        return "none"
    return "up" if b > 0 else "down"


# ----------------------------------------------------------------------------
# Diagnostics
# ----------------------------------------------------------------------------

def _dfa_alpha(x, min_box=8, n_scales=12):
    """DFA-1: ~0.5 is white noise, >0.7 is persistent dependence (long memory)."""
    x = np.cumsum(x - np.mean(x))
    N = len(x)
    if N < 64:
        return None
    scales = np.unique(np.logspace(np.log10(min_box), np.log10(N // 4), n_scales).astype(int))
    F, S = [], []
    for s in scales:
        m = N // s
        if m < 2:
            continue
        seg = x[:m * s].reshape(m, s)
        tt = np.arange(s)
        A = np.vstack([tt, np.ones(s)]).T
        coef, *_ = np.linalg.lstsq(A, seg.T, rcond=None)
        res = seg.T - A @ coef
        F.append(math.sqrt(np.mean(res ** 2)))
        S.append(s)
    if len(S) < 4 or min(F) <= 0:
        return None
    return float(np.polyfit(np.log(S), np.log(F), 1)[0])


def _rss(X, y):
    coef, *_ = np.linalg.lstsq(X, y, rcond=None)
    r = y - X @ coef
    return float(r @ r)


def _sup_f(y, t, trim=0.15, max_cand=40):
    """sup-F (Quandt-Andrews) for a break in level and slope. Returns (supF, index, slope before, slope after)."""
    n = len(y)
    lo, hi = max(int(n * trim), 4), min(int(n * (1 - trim)), n - 4)
    if hi <= lo:
        return None
    X = np.c_[np.ones(n), t]
    rss0 = _rss(X, y)
    best = (-np.inf, None)
    for k in np.unique(np.linspace(lo, hi, max_cand).astype(int)):
        rss1 = _rss(X[:k], y[:k]) + _rss(X[k:], y[k:])
        if rss1 <= 0:
            continue
        F = ((rss0 - rss1) / 2) / (rss1 / (n - 4))
        if F > best[0]:
            best = (F, int(k))
    k = best[1]
    b1 = np.polyfit(t[:k], y[:k], 1)[0]
    b2 = np.polyfit(t[k:], y[k:], 1)[0]
    return best[0], k, float(b1), float(b2)


def _ar1_noise(rng, B, n, rho, burn=100):
    z = rng.standard_normal((B, n + burn))
    e = lfilter([math.sqrt(1 - rho ** 2)], [1, -rho], z, axis=1)
    return e[:, burn:]


def _phase_surrogates(rng, x, B):
    n = len(x)
    X = np.fft.rfft(x - x.mean())
    amp = np.abs(X)
    out = np.empty((B, n))
    for b in range(B):
        ph = rng.uniform(0, 2 * np.pi, len(X))
        ph[0] = 0
        if n % 2 == 0:
            ph[-1] = 0
        out[b] = np.fft.irfft(amp * np.exp(1j * ph), n=n)
    return out


# ----------------------------------------------------------------------------
# Main function
# ----------------------------------------------------------------------------

def assess_trend(y, t=None, *, seasonal=None, period: Optional[int] = None,
                 trend_fn: Optional[Callable] = None, alpha: float = 0.05,
                 n_boot: int = 500, n_surr: int = 999, power: float = 0.8,
                 seed: int = 0) -> Report:
    rng = np.random.default_rng(seed)
    yv, tv, pos, n_total, unit = _prepare(y, t)
    n = len(yv)
    warns: list[str] = []
    tests: list[TestResult] = []
    config = dict(alpha=alpha, n_boot=n_boot, n_surr=n_surr, power=power, seed=seed, period=period)

    if n < 8:
        passport = dict(n_total=n_total, n_valid=n, time_unit=unit, regular=False, missing_frac=1 - n / max(n_total, 1),
                        r1=float("nan"), n_eff=float("nan"), stationarity_class="unknown")
        return Report(passport, [], dict(time_unit=unit), {}, ["Занадто мало точок (<8) для будь-якого тесту."],
                      "insufficient_data", "low", "n<8", config)

    if np.ptp(yv) == 0:
        passport = dict(n_total=n_total, n_valid=n, time_unit=unit, regular=True, missing_frac=1 - n / max(n_total, 1),
                        r1=float("nan"), n_eff=float("nan"), stationarity_class="constant")
        return Report(passport, [], dict(time_unit=unit), {}, ["Ряд константний: тренд не визначений."],
                      "insufficient_data", "low", "ряд без варіації", config)

    # --- passport: regularity, gaps ---------------------------------
    dt = np.diff(tv)
    med_dt = float(np.median(dt))
    regular = bool(np.all(np.abs(dt - med_dt) <= 0.15 * med_dt))
    missing_frac = 1 - n / n_total
    if missing_frac > 0.05:
        warns.append(f"Пропущено {missing_frac:.1%} значень: тести, що спираються на порядок точок "
                     "(TFPW, Ljung-Box, DFA), менш надійні. Не інтерполюйте без потреби.")
    if not regular:
        warns.append("Нерегулярний часовий крок: автокореляційні поправки наближені (враховується лише порядок точок).")
    if n < 30:
        warns.append(f"Мала вибірка (n={n}): асимптотичні p-значення ненадійні; спирайтеся на bootstrap/сурогати.")

    tc = tv - tv.mean()
    sxx = float(tc @ tc)
    span = float(tv[-1] - tv[0])

    # --- baseline OLS and residuals -------------------------------------------
    X = np.c_[np.ones(n), tc]
    ols = sm.OLS(yv, X).fit()
    b_ols = float(ols.params[1])
    resid = np.asarray(ols.resid)
    sigma = float(np.std(resid, ddof=2))
    b_sen, a_sen = _sen_slope(yv, tv)
    resid_sen = yv - b_sen * tv - a_sen          # residuals of the robust trend
    r1 = _lag1(resid_sen)
    rho_c = float(np.clip(r1, -0.95, 0.95))
    n_eff = n * (1 - rho_c) / (1 + rho_c) if rho_c > -0.95 else n
    sig_autocorr = abs(r1) > 1.96 / math.sqrt(n)

    # --- Blocks A/B: diagnostics -------------------------------------------
    diag = {}
    lags = max(1, min(10, n // 5))
    try:
        lb = acorr_ljungbox(resid_sen, lags=[lags], return_df=True)
        diag["ljung_box_p"] = float(lb["lb_pvalue"].iloc[0])
    except Exception:
        diag["ljung_box_p"] = None
    diag["durbin_watson"] = float(durbin_watson(resid))
    if diag["ljung_box_p"] is not None and diag["ljung_box_p"] < alpha:
        sig_autocorr = True
    try:
        diag["breusch_pagan_p"] = float(het_breuschpagan(resid, X)[1])
    except Exception:
        diag["breusch_pagan_p"] = None
    try:
        diag["jarque_bera_p"] = float(jarque_bera(resid)[1])
        diag["shapiro_p"] = float(stats.shapiro(resid)[1]) if n <= 5000 else None
    except Exception:
        diag["jarque_bera_p"] = diag["shapiro_p"] = None
    heterosk = diag["breusch_pagan_p"] is not None and diag["breusch_pagan_p"] < alpha
    nonnormal = diag["jarque_bera_p"] is not None and diag["jarque_bera_p"] < alpha
    if heterosk:
        warns.append("Гетероскедастичність залишків (Breusch-Pagan): класичний t-тест ненадійний, "
                     "використано HAC/bootstrap. Розгляньте логарифм або Box-Cox.")
    if nonnormal:
        warns.append("Залишки ненормальні (Jarque-Bera): перевага непараметричних тестів і bootstrap.")

    # unit root
    stationarity = "unknown"
    adf_p = kpss_p = None
    if n >= 15:
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                adf_p = float(adfuller(yv, regression="ct", autolag="AIC")[1])
                kpss_p = float(kpss(yv, regression="ct", nlags="auto")[1])
            if adf_p < alpha and kpss_p >= alpha:
                stationarity = "trend_stationary"
            elif adf_p >= alpha and kpss_p < alpha:
                stationarity = "unit_root"
            else:
                stationarity = "ambiguous"
        except Exception:
            pass
    dfa = _dfa_alpha(resid_sen)
    # "possible unit root": do not rely on ADF/KPSS alone (their power is limited)
    possible_unit_root = (stationarity in ("unit_root", "ambiguous") or r1 > 0.85
                          or (dfa is not None and dfa > 1.0))
    if stationarity == "unit_root":
        warns.append("ADF/KPSS вказують на одиничний корінь (стохастичний тренд): регресія на час "
                     "може давати ХИБНУ значущість; довіряйте тесту дрейфу на різницях.")
    elif stationarity == "ambiguous":
        warns.append("ADF і KPSS не узгоджені: тип тренду (детермінований/стохастичний) неоднозначний.")
    elif possible_unit_root:
        warns.append(f"ADF/KPSS не бачать одиничного кореня, але ряд близький до нього (r1={r1:.2f}, "
                     f"DFA α={_fmt(dfa)}): ризик хибного тренду, враховано тест дрейфу на різницях.")
    if dfa is not None and dfa > 0.75:
        warns.append(f"Ознаки довгої пам'яті (DFA α≈{dfa:.2f}): стандартні тести завищують значущість; "
                     "вага bootstrap/сурогатів і фазових сурогатів зростає.")

    # Residual seasonality. Look at FIRST DIFFERENCES of neighbouring points (by step number):
    # they do not depend on the trend or its curvature (ACF/KW on OLS residuals gave false alarms).
    resid_seas = None
    if period and period > 1 and n >= 2 * period:
        consec = np.diff(pos) == 1
        d_all = np.diff(yv)[consec]
        g_all = pos[1:][consec] % period
        groups = [d_all[g_all == k] for k in range(period)]
        groups = [g for g in groups if len(g) >= 2]
        if len(groups) >= 2 and np.ptp(d_all) > 0:
            try:
                kw_p = float(stats.kruskal(*groups)[1])
            except ValueError:
                kw_p = 1.0
            group_means = np.array([g.mean() for g in groups])
            diag["resid_seasonality_kw_p"] = kw_p
            diag["resid_seasonality_max_jump"] = float(np.ptp(group_means))
            resid_seas = bool(kw_p < alpha)
            if resid_seas:
                warns.append(f"Залишкова сезонність з періодом {period} (Kruskal-Wallis на різницях, p={kw_p:.2g}; "
                             f"розкид середніх приростів по місяцях {np.ptp(group_means):.3g}). Типова причина: сезонна "
                             "кліматологія, обчислена на ряді з трендом і неповними роками; рахуйте її з детрендованого ряду "
                             "або використайте STL. Тренд і p-значення можуть бути викривлені.")

    # structural breaks
    brk = {}
    try:
        cs = breaks_cusumolsresid(resid)
        brk["cusum_p"] = float(cs[1])
    except Exception:
        brk["cusum_p"] = None
    sup = _sup_f(yv, tv) if n >= 30 else None
    break_sign_change = False
    if sup is not None:
        F_obs, kbest, b1, b2 = sup
        # Monte Carlo p-value under H0 "single straight line + AR(1) noise"
        B = 200
        sims = np.empty(B)
        e = _ar1_noise(rng, B, n, rho_c) * sigma
        fitline = ols.fittedvalues
        for k in range(B):
            sims[k] = _sup_f(fitline + e[k], tv)[0]
        p_sup = float((1 + np.sum(sims >= F_obs)) / (B + 1))
        brk.update(sup_f=float(F_obs), sup_f_p=p_sup, break_time=float(tv[kbest]),
                   slope_before=b1, slope_after=b2)
        if p_sup < alpha:
            break_sign_change = bool(np.sign(b1) != np.sign(b2))
            warns.append(f"Виявлено структурний злам тренду (sup-F, p={p_sup:.3f}) близько t={tv[kbest]:.4g}: "
                         f"нахил до={b1:.3g}, після={b2:.3g}. Єдиний лінійний нахил може бути недоречним."
                         + (" Знак нахилу змінюється." if break_sign_change else ""))
    if n >= 30 and brk.get("cusum_p") is not None and brk["cusum_p"] < alpha and "sup_f" in brk and brk["sup_f_p"] >= alpha:
        warns.append("CUSUM вказує на нестабільність залишків навколо лінійного тренду (можлива нелінійність).")

    # outliers
    mad = np.median(np.abs(resid_sen - np.median(resid_sen))) * 1.4826
    outl = np.abs(resid_sen - np.median(resid_sen)) > 3.5 * mad if mad > 0 else np.zeros(n, bool)
    if outl.any():
        warns.append(f"Викидів (|z|>3.5 за MAD): {int(outl.sum())}; перевірено стійкість без них.")
    if np.unique(yv).size < 0.8 * n:
        warns.append("Багато однакових значень (ties): застосовано поправку в дисперсії Манна-Кендалла.")

    passport = dict(n_total=n_total, n_valid=n, time_unit=unit, regular=regular, missing_frac=missing_frac,
                    span=span, r1=r1, n_eff=float(n_eff), significant_autocorrelation=bool(sig_autocorr),
                    stationarity_class=stationarity, adf_p=adf_p, kpss_p=kpss_p, dfa_alpha=dfa,
                    residual_seasonality=resid_seas, outliers=int(outl.sum()), diagnostics=diag, breaks=brk)

    # --- Block C: trend tests ---------------------------------------------
    maxlags = int(max(1, np.floor(4 * (n / 100.0) ** (2 / 9))))

    def add(res: TestResult):
        if res.p_value is not None and res.significant is None:
            res.significant = bool(res.p_value < alpha)
        if res.direction is None and res.estimate is not None:
            res.direction = _direction(res.estimate, res.significant)
        tests.append(res)

    # 1. OLS: classical t-test (reference only; votes only if there is no autocorrelation/heteroscedasticity)
    iid_ok = (not sig_autocorr) and (not heterosk)
    add(TestResult("OLS t-тест (класичний)", "parametric", statistic=float(ols.tvalues[1]),
                   p_value=float(ols.pvalues[1]), estimate=b_ols / 1.0,
                   ci=tuple(map(float, ols.conf_int(alpha)[1])), voting=iid_ok,
                   note="" if iid_ok else "довідково: порушено незалежність/однорідність"))

    # 2. OLS + HAC (Newey-West), t distribution
    try:
        hac = sm.OLS(yv, X).fit(cov_type="HAC", cov_kwds={"maxlags": maxlags, "use_correction": True}, use_t=True)
        add(TestResult("OLS + HAC (Newey-West)", "parametric", statistic=float(hac.tvalues[1]),
                       p_value=float(hac.pvalues[1]), estimate=b_ols,
                       ci=tuple(map(float, hac.conf_int(alpha)[1])), note=f"maxlags={maxlags}"))
    except Exception as ex:
        add(TestResult("OLS + HAC (Newey-West)", "parametric", applicable=False, note=str(ex)[:40]))

    # 3. Regression with AR(1) errors (maximum likelihood)
    try:
        from statsmodels.tsa.statespace.sarimax import SARIMAX
        tstd = tc / tc.std()
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            m1 = SARIMAX(yv, exog=tstd, order=(1, 0, 0), trend="c").fit(disp=False)
            m0 = SARIMAX(yv, order=(1, 0, 0), trend="c").fit(disp=False)
        coef = float(m1.params[1]) / float(tc.std())
        ci = m1.conf_int(alpha)[1] / float(tc.std())
        lr = 2 * (m1.llf - m0.llf)
        add(TestResult("Регресія з AR(1)-помилками (Wald)", "parametric", statistic=float(m1.tvalues[1]),
                       p_value=float(m1.pvalues[1]), estimate=coef, ci=(float(ci[0]), float(ci[1])),
                       note=f"LR p={1 - stats.chi2.cdf(lr, 1):.3g}; ΔAIC={m0.aic - m1.aic:.1f}"))
        diag["delta_aic_trend_vs_none"] = float(m0.aic - m1.aic)
        diag["delta_bic_trend_vs_none"] = float(m0.bic - m1.bic)
    except Exception as ex:
        add(TestResult("Регресія з AR(1)-помилками (Wald)", "parametric", applicable=False, note=str(ex)[:40]))

    # 4. Mann-Kendall (naive) + Sen
    S, var, z, p_mk, tau = _mk_core(yv)
    slopes, full = _pair_slopes(yv, tv)
    ci_sen = None
    if full:
        C = stats.norm.ppf(1 - alpha / 2) * math.sqrt(var)
        N = len(slopes)
        srt = np.sort(slopes)
        lo = int(np.clip(math.floor((N - C) / 2) - 1, 0, N - 1))
        hi = int(np.clip(math.ceil((N + C) / 2), 0, N - 1))
        ci_sen = (float(srt[lo]), float(srt[hi]))
    add(TestResult("Манн-Кендалл + Theil-Sen (наївний)", "nonparametric", statistic=float(z), p_value=float(p_mk),
                   estimate=b_sen, ci=ci_sen, voting=not sig_autocorr,
                   note=f"tau={tau:.3f}" + ("" if not sig_autocorr else "; довідково: є автокореляція")))

    # 5. TFPW + MK, Hamed-Rao
    z_t, p_t, r1_t, prewhitened = _tfpw_mk(yv, alpha)
    add(TestResult("Манн-Кендалл TFPW (Yue-Pilon)", "nonparametric", statistic=float(z_t), p_value=float(p_t),
                   estimate=b_sen, voting=bool(sig_autocorr),
                   note=f"r1={r1_t:.2f}" + ("" if prewhitened else "; автокореляція незначуща (=звичайний MK)")))
    if _pmk is not None:
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                hr = _pmk.hamed_rao_modification_test(yv, alpha=alpha)
            add(TestResult("Манн-Кендалл Hamed-Rao", "nonparametric", statistic=float(hr.z), p_value=float(hr.p),
                           estimate=b_sen, voting=bool(sig_autocorr),
                           note="поправка на значущі лаги ACF"))
        except Exception as ex:
            add(TestResult("Манн-Кендалл Hamed-Rao", "nonparametric", applicable=False, note=str(ex)[:40]))
    else:
        add(TestResult("Манн-Кендалл Hamed-Rao", "nonparametric", applicable=False, note="pip install pymannkendall"))

    # 6. Spearman (reference only)
    rho_s, p_s = stats.spearmanr(tv, yv)
    add(TestResult("Spearman ρ (час)", "nonparametric", statistic=float(rho_s), p_value=float(p_s),
                   estimate=b_sen, voting=False, note="довідково, без поправки на автокореляцію"))

    # 7. Drift test on first differences (guards against a spurious trend)
    d = np.diff(yv)
    try:
        dm = sm.OLS(d, np.ones(len(d))).fit(cov_type="HAC", cov_kwds={"maxlags": maxlags}, use_t=True)
        drift = float(dm.params[0]) / med_dt
        add(TestResult("Дрейф на перших різницях (HAC)", "parametric", statistic=float(dm.tvalues[0]),
                       p_value=float(dm.pvalues[0]), estimate=drift,
                       ci=tuple(float(v) / med_dt for v in dm.conf_int(alpha)[0]),
                       voting=possible_unit_root,
                       note="для I(1)-рядів" if possible_unit_root else "довідково"))
    except Exception as ex:
        add(TestResult("Дрейф на перших різницях (HAC)", "parametric", applicable=False, note=str(ex)[:40]))

    # --- Block D: resampling ---------------------------------------------------
    # 8. Block bootstrap of residuals
    l_blk = int(np.clip(round(n ** (1 / 3) * (1 + max(rho_c, 0)) / (1 - max(rho_c, 0))), 2, max(2, n // 4)))
    nb = math.ceil(n / l_blk)
    starts = rng.integers(0, n - l_blk + 1, (n_boot, nb))
    idx = (starts[:, :, None] + np.arange(l_blk)[None, None, :]).reshape(n_boot, -1)[:, :n]
    Yb = ols.fittedvalues[None, :] + resid[idx]
    bs_ols = _ols_slope_vec(Yb, tc, sxx)
    lo_b, hi_b = np.percentile(bs_ols, [100 * alpha / 2, 100 * (1 - alpha / 2)])
    p_b = float(min(1.0, 2 * min(np.mean(bs_ols <= 0), np.mean(bs_ols >= 0)) + 1.0 / n_boot))
    add(TestResult("Блоковий bootstrap (нахил OLS)", "resampling", p_value=p_b, estimate=b_ols,
                   ci=(float(lo_b), float(hi_b)), note=f"блок={l_blk}, B={n_boot}"))
    if n <= 250:
        Bs = min(n_boot, 300)
        sen_res = yv - b_sen * tv - a_sen
        idx2 = idx[:Bs]
        bs_sen = np.array([_sen_slope(b_sen * tv + a_sen + sen_res[idx2[k]], tv)[0] for k in range(Bs)])
        lo_s, hi_s = np.percentile(bs_sen, [100 * alpha / 2, 100 * (1 - alpha / 2)])
        p_bs = float(min(1.0, 2 * min(np.mean(bs_sen <= 0), np.mean(bs_sen >= 0)) + 1.0 / Bs))
        add(TestResult("Блоковий bootstrap (нахил Theil-Sen)", "resampling", p_value=p_bs, estimate=b_sen,
                       ci=(float(lo_s), float(hi_s)), note=f"блок={l_blk}, B={Bs}"))

    # 9. Surrogate tests
    obs_slope = b_ols
    res_for_surr = resid_sen
    surr_ar = _ar1_noise(rng, n_surr, n, rho_c) * res_for_surr.std()
    s_ar = _ols_slope_vec(surr_ar, tc, sxx)
    p_ar = float((1 + np.sum(np.abs(s_ar) >= abs(obs_slope))) / (n_surr + 1))
    add(TestResult("Сурогати AR(1) (H0: шум без тренду)", "surrogate", p_value=p_ar, estimate=obs_slope,
                   note=f"ρ={rho_c:.2f}, B={n_surr}"))
    if n >= 32:
        surr_ph = _phase_surrogates(rng, res_for_surr, n_surr)
        s_ph = _ols_slope_vec(surr_ph, tc, sxx)
        p_ph = float((1 + np.sum(np.abs(s_ph) >= abs(obs_slope))) / (n_surr + 1))
        long_mem = dfa is not None and dfa > 0.75
        add(TestResult("Фазові сурогати (зберігають спектр)", "surrogate", p_value=p_ph, estimate=obs_slope,
                       note="зберігає форму спектра шуму" + ("; довга пам'ять" if long_mem else "")))

    # 10. Stage 2 method (trend_fn)
    if trend_fn is not None:
        try:
            def stat_fn(arr):
                tr = np.asarray(trend_fn(arr), dtype=float)
                return float(tr[-1] - tr[0])
            obs = stat_fn(yv)
            Bf = min(n_surr, 299)
            sims = np.empty(Bf)
            for k in range(Bf):
                sims[k] = stat_fn(surr_ar[k] + yv.mean())
            p_f = float((1 + np.sum(np.abs(sims) >= abs(obs))) / (Bf + 1))
            add(TestResult("Тренд етапу 2: сурогати AR(1)", "surrogate", statistic=obs, p_value=p_f,
                           estimate=obs / span if span else None, direction=_direction(obs, p_f < alpha),
                           note=f"статистика = повна зміна тренду; B={Bf}"))
        except Exception as ex:
            add(TestResult("Тренд етапу 2: сурогати AR(1)", "surrogate", applicable=False, note=str(ex)[:40]))

    # --- Block D: sensitivity -------------------------------------------------
    variants = []
    wins = [(0, 1), (0.1, 1), (0, 0.9), (0.1, 0.9), (0.2, 1), (0, 0.8), (0.2, 0.8)]
    for a, bnd in wins:
        i0, i1 = int(a * n), int(bnd * n)
        if i1 - i0 >= 10:
            variants.append((f"вікно {a:.0%}-{bnd:.0%}", yv[i0:i1], tv[i0:i1]))
    if outl.any() and (~outl).sum() >= 10:
        variants.append(("без викидів", yv[~outl], tv[~outl]))
    sens_rows = []
    for name, ys, ts in variants:
        bsl, _ = _sen_slope(ys, ts)
        zz, pp, _, _ = _tfpw_mk(ys, alpha)
        sens_rows.append(dict(variant=name, slope=bsl, p=pp, sign=int(np.sign(bsl)), significant=bool(pp < alpha)))
    base_sign = np.sign(b_sen)
    sensitivity = {}
    if sens_rows:
        sensitivity = dict(
            n_variants=len(sens_rows),
            share_same_sign=float(np.mean([r["sign"] == base_sign for r in sens_rows])),
            share_significant=float(np.mean([r["significant"] and r["sign"] == base_sign for r in sens_rows])),
            variants=sens_rows)

    # --- Block E: practical significance, power --------------------------
    total_change = b_sen * span
    se_b = sigma / math.sqrt(sxx) * math.sqrt((1 + max(rho_c, 0)) / (1 - max(rho_c, 0)))
    zsum = stats.norm.ppf(1 - alpha / 2) + stats.norm.ppf(power)
    mdt = zsum * se_b
    ratio = mdt / abs(b_sen) if b_sen != 0 else np.inf
    n_needed = n if ratio <= 1 else (math.ceil(n * ratio ** (2 / 3)) if np.isfinite(ratio) else None)
    effect = dict(time_unit=unit, slope=b_sen, slope_ols=b_ols, total_change=total_change,
                  total_change_sigma=total_change / sigma if sigma > 0 else None,
                  total_change_pct_of_mean=(100 * total_change / abs(yv.mean())) if abs(yv.mean()) > sigma else None,
                  noise_sigma=sigma, min_detectable_slope=mdt, n_needed=n_needed,
                  power_note="оцінка для регулярного кроку, AR(1)-інфляція дисперсії")
    if seasonal is not None:
        sv = np.asarray(seasonal, dtype=float)
        sv = sv[np.isfinite(sv)]
        if sv.size:
            amp = float((sv.max() - sv.min()) / 2)
            effect["seasonal_amplitude"] = amp
            effect["change_to_seasonal_ratio"] = abs(total_change) / amp if amp > 0 else None
    if sigma > 0 and abs(total_change) < sigma:
        warns.append("Повна зміна тренду менша за σ шуму: навіть статистично значущий тренд практично малий.")
    if ratio > 1:
        warns.append(f"Недостатня потужність: мінімальний виявлюваний нахил ({mdt:.3g}) більший за "
                     f"спостережуваний ({abs(b_sen):.3g}). Незначущість ≠ відсутність тренду.")

    # --- Verdict --------------------------------------------------------------
    voters = [t for t in tests if t.applicable and t.voting and t.p_value is not None]
    sign = int(np.sign(b_sen)) or 1
    n_sig_same = sum(1 for t in voters if t.significant and (t.estimate is None or np.sign(t.estimate) == sign))
    n_sig_opp = sum(1 for t in voters if t.significant and t.estimate is not None and np.sign(t.estimate) != sign)
    share = n_sig_same / len(voters) if voters else 0.0
    rationale_parts = [f"значущими є {n_sig_same} з {len(voters)} тестів, що голосують"]
    if n_sig_opp:
        rationale_parts.append(f"{n_sig_opp} значущих з протилежним знаком")

    if n_sig_opp or (0.25 < share < 0.75):
        verdict = "ambiguous"
    elif share >= 0.75:
        verdict = "significant_up" if sign > 0 else "significant_down"
    else:
        verdict = "not_significant"

    # downgrade the verdict for instability / break / unit root
    if verdict.startswith("significant"):
        if sensitivity and (sensitivity["share_same_sign"] < 0.8 or sensitivity["share_significant"] < 0.5):
            verdict = "ambiguous"
            rationale_parts.append("результат нестійкий до зсуву вікна/викидів")
        if break_sign_change:
            verdict = "ambiguous"
            rationale_parts.append("знак тренду змінюється на зламі: єдиний монотонний тренд недоречний")
        if possible_unit_root:
            dr = next((t for t in tests if t.name.startswith("Дрейф") and t.applicable), None)
            if dr is not None and not dr.significant:
                verdict = "ambiguous"
                rationale_parts.append("ряд схожий на random walk, а дрейф на різницях незначущий (ризик хибного тренду)")
    if verdict == "not_significant" and brk.get("sup_f_p") is not None and brk["sup_f_p"] < alpha:
        verdict = "ambiguous"
        rationale_parts.append("монотонного тренду не виявлено, але є значущий злам: можливий кусково-лінійний тренд")

    level = 2  # 2 high, 1 medium, 0 low
    penalties = 0
    penalties += n < 30
    penalties += bool(resid_seas)
    penalties += bool(possible_unit_root)
    penalties += bool(dfa is not None and dfa > 0.75)
    penalties += bool(brk.get("sup_f_p") is not None and brk["sup_f_p"] < alpha)
    penalties += missing_frac > 0.05
    penalties += bool(sensitivity and sensitivity["share_same_sign"] < 1.0)
    penalties += verdict == "ambiguous"
    penalties += bool(verdict == "not_significant" and ratio > 1)
    level = 2 if penalties <= 1 else (1 if penalties <= 3 else 0)
    if resid_seas:  # residual seasonality: confidence at most medium
        level = min(level, 1)
    confidence = ["low", "medium", "high"][level]

    return Report(passport, [asdict(t) for t in tests], effect, sensitivity, warns, verdict, confidence,
                  "; ".join(rationale_parts), config)


# ----------------------------------------------------------------------------
# CLI and demo
# ----------------------------------------------------------------------------

def _demo():
    rng = np.random.default_rng(42)
    n = 240
    t = np.arange(n) / 12.0  # monthly data, time in years

    def ar1(rho, n):
        e = np.zeros(n)
        for i in range(1, n):
            e[i] = rho * e[i - 1] + rng.standard_normal()
        return e

    cases = {
        "A: справжній тренд + AR(1)": 0.15 * t + ar1(0.5, n),
        "B: лише AR(1)-шум, без тренду": ar1(0.7, n),
        "C: random walk (хибний тренд)": np.cumsum(rng.standard_normal(n)),
        "D: тренд зі зламом (вгору, потім вниз)": np.r_[0.4 * t[:120], 0.4 * t[119] - 0.4 * (t[120:] - t[119])] + ar1(0.3, n),
    }
    for name, y in cases.items():
        print(f"\n\n##### {name}")
        print(assess_trend(y, t, n_boot=300, n_surr=499).summary())


def _cli():
    ap = argparse.ArgumentParser(description="Перевірка значущості тренду (етап 3)")
    ap.add_argument("csv", nargs="?", help="CSV з даними")
    ap.add_argument("--value", help="колонка зі значеннями (після видалення сезонності)")
    ap.add_argument("--time", help="колонка з часом (дати або числа); за замовчуванням номер рядка")
    ap.add_argument("--seasonal", help="колонка із сезонною компонентою (необов'язково)")
    ap.add_argument("--period", type=int, help="період сезонності в точках")
    ap.add_argument("--alpha", type=float, default=0.05)
    ap.add_argument("--json", help="шлях для збереження звіту у JSON")
    ap.add_argument("--demo", action="store_true", help="синтетичні приклади")
    a = ap.parse_args()
    if a.demo:
        return _demo()
    if not a.csv or not a.value:
        ap.error("потрібні csv і --value (або --demo)")
    import pandas as pd
    df = pd.read_csv(a.csv)
    t = None
    if a.time:
        try:
            t = pd.to_datetime(df[a.time]).to_numpy()
        except Exception:
            t = df[a.time].to_numpy(dtype=float)
    seas = df[a.seasonal].to_numpy(dtype=float) if a.seasonal else None
    rep = assess_trend(df[a.value].to_numpy(dtype=float), t, seasonal=seas, period=a.period, alpha=a.alpha)
    print(rep.summary())
    if a.json:
        rep.to_json(a.json)
        print(f"\nJSON збережено: {a.json}")


if __name__ == "__main__":
    _cli()
