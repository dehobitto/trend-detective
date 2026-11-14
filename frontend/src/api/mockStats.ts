/**
 * Trend statistics for the in-browser mock only (the real numbers come from backend/app/processing/trends.py).
 * OLS + t-test with CI, Mann-Kendall, Sen's slope.
 */

function logGamma(x: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const ci of c) ser += ci / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function betacf(a: number, b: number, x: number): number {
  const MAXIT = 200, EPS = 3e-14, FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

function incBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** Two-sided p-value for Student's t. */
export function tTwoSidedP(t: number, df: number): number {
  return incBeta(df / 2, 0.5, df / (df + t * t));
}

/** Critical t for a two-sided test at level alpha (bisection). */
export function tCritical(alpha: number, df: number): number {
  let lo = 0, hi = 100;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (tTwoSidedP(mid, df) > alpha) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

function erf(x: number): number {
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
const normTwoSidedP = (z: number) => 1 - erf(Math.abs(z) / Math.SQRT2);

export type OlsFit = {
  slope: number; intercept: number; se: number; t: number; p: number; r2: number;
  ciLow: number; ciHigh: number; tcrit: number; s: number; xbar: number; sxx: number; n: number;
};

export function ols(x: number[], y: number[], alpha: number): OlsFit {
  const n = x.length;
  const xbar = x.reduce((a, b) => a + b, 0) / n;
  const ybar = y.reduce((a, b) => a + b, 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (x[i] - xbar) ** 2; sxy += (x[i] - xbar) * (y[i] - ybar); syy += (y[i] - ybar) ** 2;
  }
  const slope = sxy / sxx;
  const intercept = ybar - slope * xbar;
  let sse = 0;
  for (let i = 0; i < n; i++) sse += (y[i] - (intercept + slope * x[i])) ** 2;
  const df = n - 2;
  const s = Math.sqrt(sse / df);
  const se = s / Math.sqrt(sxx);
  const t = slope / se;
  const tcrit = tCritical(alpha, df);
  return {
    slope, intercept, se, t, p: tTwoSidedP(t, df), r2: syy > 0 ? 1 - sse / syy : 0,
    ciLow: slope - tcrit * se, ciHigh: slope + tcrit * se, tcrit, s, xbar, sxx, n,
  };
}

export function mannKendall(y: number[]): { tau: number; z: number; p: number } {
  const n = y.length;
  let S = 0;
  for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) S += Math.sign(y[j] - y[i]);
  const varS = (n * (n - 1) * (2 * n + 5)) / 18;
  const z = S > 0 ? (S - 1) / Math.sqrt(varS) : S < 0 ? (S + 1) / Math.sqrt(varS) : 0;
  return { tau: S / ((n * (n - 1)) / 2), z, p: normTwoSidedP(z) };
}

export function sensSlope(x: number[], y: number[]): number {
  const slopes: number[] = [];
  for (let i = 0; i < x.length - 1; i++)
    for (let j = i + 1; j < x.length; j++) if (x[j] !== x[i]) slopes.push((y[j] - y[i]) / (x[j] - x[i]));
  slopes.sort((a, b) => a - b);
  const m = slopes.length >> 1;
  return slopes.length % 2 ? slopes[m] : (slopes[m - 1] + slopes[m]) / 2;
}
