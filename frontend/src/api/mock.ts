/**
 * In-browser mock of docs/API.md, used when VITE_USE_MOCKS=true or the backend is unreachable.
 * Only src/api/client.ts imports this file. Data is synthetic but deterministic per request,
 * so the same area + variable + dates always gives the same answer.
 */
import { MOCK_EXAMPLES, MOCK_STORY_TRENDS, MOCK_VARIABLES, type MockVariable } from './mockCatalog';
import { mannKendall, ols, sensSlope } from './mockStats';
import { mockGeocode, mockGrid, mockGridDates, mockMapLayer } from './mockGrid';
import {
  UPLOAD_PREFIX,
  type AnalysisRequest,
  type AnalysisResult,
  type BBox,
  type ChatRequest,
  type Dataset,
  type Job,
  type JobStatus,
  type SeriesPoint,
  type TrendApi,
  type TrendStats,
  type Variable,
} from './types';

const STAGE_MS = 350;
const STAGES: { status: JobStatus; message: string }[] = [
  { status: 'queued', message: 'Waiting to start' },
  { status: 'fetching', message: 'Fetching monthly data for your area' },
  { status: 'processing', message: 'Averaging over the area and removing the seasonal cycle' },
  { status: 'analyzing', message: 'Fitting the trend and running significance tests' },
];

class MockError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ randomness */

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/* ------------------------------------------------------------------ dates */

const iso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (s: string) => new Date(`${s}T00:00:00Z`);
const decimalYear = (s: string) => {
  const d = parse(s);
  const y = d.getUTCFullYear();
  const start = Date.UTC(y, 0, 1);
  return y + (d.getTime() - start) / (Date.UTC(y + 1, 0, 1) - start);
};

function monthStarts(start: string, end: string): string[] {
  const out: string[] = [];
  const s = parse(start);
  const e = parse(end);
  const d = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 1));
  while (d <= e) {
    out.push(iso(d));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

/* ------------------------------------------------------------------ data generation */

type Raw = { date: string; value: number }[];

function synthesize(v: MockVariable, bbox: BBox, start: string, end: string): Raw {
  const lat = (bbox.south + bbox.north) / 2;
  const lon = (bbox.west + bbox.east) / 2;
  const regionKey = `${v.id}|${lat.toFixed(1)}|${lon.toFixed(1)}`;
  const regional = mulberry32(hashString(regionKey));
  // Most regions follow the variable's typical sign; some go the other way (that's the point of the challenge).
  let factor = regional() * 2.4 - 0.6;
  if (v.units === '°C') {
    factor = Math.abs(factor) + 0.3; // temperatures mostly warm…
    if (Math.abs(lat) > 55) factor *= 1 + (Math.abs(lat) - 55) / 7; // …and polar amplification
  }
  const story = MOCK_STORY_TRENDS.find((s) => s.variable_id === v.id && JSON.stringify(s.bbox) === JSON.stringify(bbox));
  if (story) factor = story.factor;
  if (v.fixedTrend) factor = 1;
  const trendPerYear = (v.trend * factor) / 10;
  const peakMonth = lat >= 0 ? 6.5 : 0.5;
  const amp = v.amp(lat);
  const base = v.base(lat);

  const rand = mulberry32(hashString(`${regionKey}|${start}|${end}`));
  let red = 0;
  // Global records are anchored to their first year so values stay realistic for any window.
  const t0 = decimalYear(v.fixedTrend ? v.available_start : start);
  return monthStarts(start, end).map((date) => {
    const m = parse(date).getUTCMonth();
    red = 0.55 * red + gaussian(rand) * v.noise;
    let value = base + amp * Math.cos(((m - peakMonth) / 12) * 2 * Math.PI) + trendPerYear * (decimalYear(date) - t0) + red;
    if (v.min !== undefined) value = Math.max(v.min, value);
    return { date, value };
  });
}

/* ------------------------------------------------------------------ pipeline */

function toMonthly(raw: Raw): Raw {
  const buckets = new Map<string, number[]>();
  for (const p of raw) {
    const key = `${p.date.slice(0, 7)}-01`;
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(p.value);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, vals]) => ({ date, value: vals.reduce((a, b) => a + b, 0) / vals.length }));
}

function toAnnual(raw: Raw): Raw {
  const buckets = new Map<string, number[]>();
  for (const p of raw) {
    const key = `${p.date.slice(0, 4)}-01-01`;
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(p.value);
  }
  return [...buckets.entries()]
    .filter(([, vals]) => vals.length >= 6)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, vals]) => ({ date, value: vals.reduce((a, b) => a + b, 0) / vals.length }));
}

function anomalies(raw: Raw): number[] {
  const sums = new Array(12).fill(0);
  const counts = new Array(12).fill(0);
  for (const p of raw) {
    const m = parse(p.date).getUTCMonth();
    sums[m] += p.value;
    counts[m]++;
  }
  return raw.map((p) => {
    const m = parse(p.date).getUTCMonth();
    return p.value - sums[m] / counts[m];
  });
}

function fmtNum(x: number): string {
  const a = Math.abs(x);
  const digits = a >= 10 ? 1 : a >= 1 ? 2 : a >= 0.1 ? 3 : 4;
  return Number(x.toFixed(digits)).toString();
}

function fmtP(p: number): string {
  return p < 0.001 ? 'p < 0.001' : `p = ${p.toFixed(3)}`;
}

function summarize(stats: TrendStats, units: string): string {
  const u = units === 'unitless' || units === 'index' ? '' : ` ${units}`;
  const rate = `${fmtNum(Math.abs(stats.slope_per_decade))}${u} per decade`;
  const head = stats.direction === 'flat' ? `Essentially flat (${rate}).` : `${stats.direction === 'rising' ? 'Rising' : 'Falling'} by ${rate}.`;
  if (stats.significant) return `${head} Both tests agree this trend is significant (${fmtP(stats.p_value)}).`;
  const agree = stats.p_value < stats.alpha || stats.mk_p_value < stats.alpha;
  return agree
    ? `${head} Only one of the two tests finds it significant, so treat it with caution (${fmtP(stats.p_value)}).`
    : `${head} This is not significant: it could be natural ups and downs (${fmtP(stats.p_value)}).`;
}

function analyze(variable: Variable, bbox: BBox | null, raw: Raw, req: AnalysisRequest, provider: string, synthetic: boolean): AnalysisResult {
  const warnings: string[] = [];
  const annual = req.aggregation === 'annual';
  const series = annual ? toAnnual(raw) : toMonthly(raw);
  if (series.length < 4) throw new MockError('Not enough data points to fit a trend. Try a longer date range.', 422);
  const deseason = req.deseasonalize && !annual;
  const analyzed = deseason ? anomalies(series) : series.map((p) => p.value);
  const x = series.map((p) => decimalYear(p.date));
  const fit = ols(x, analyzed, req.alpha);
  const mk = mannKendall(analyzed);
  const sen = sensSlope(x, analyzed);
  const span = x[x.length - 1] - x[0];
  if (span < 10) warnings.push('Fewer than 10 years of data: trends over short periods are easily swayed by a few unusual years.');
  if (req.deseasonalize && annual) warnings.push('Annual averages already remove the seasonal cycle, so deseasonalizing was skipped.');

  const mean = series.reduce((a, p) => a + p.value, 0) / series.length;
  const totalChange = fit.slope * span;
  const significant = fit.p < req.alpha && mk.p < req.alpha;
  const relSlope = Math.abs(fit.slope * 10) / (Math.abs(mean) || 1);
  const direction: TrendStats['direction'] = relSlope < 1e-4 ? 'flat' : fit.slope > 0 ? 'rising' : 'falling';

  const stats: TrendStats = {
    n: series.length,
    slope_per_year: fit.slope,
    slope_per_decade: fit.slope * 10,
    slope_ci_low_per_decade: fit.ciLow * 10,
    slope_ci_high_per_decade: fit.ciHigh * 10,
    intercept: fit.intercept,
    r_squared: fit.r2,
    t_stat: fit.t,
    p_value: fit.p,
    mk_tau: mk.tau,
    mk_z: mk.z,
    mk_p_value: mk.p,
    sens_slope_per_decade: sen * 10,
    total_change: totalChange,
    // Percent change is meaningless on interval scales like °C (0 is arbitrary), so the backend sends null there.
    percent_change: !variable.units.includes('°') && Math.abs(mean) > 1e-6 ? (totalChange / Math.abs(mean)) * 100 : null,
    direction,
    significant,
    alpha: req.alpha,
  };

  const points: SeriesPoint[] = series.map((p, i) => {
    const xi = x[i];
    const yhat = fit.intercept + fit.slope * xi;
    const half = fit.tcrit * fit.s * Math.sqrt(1 / fit.n + (xi - fit.xbar) ** 2 / fit.sxx);
    return {
      date: p.date,
      value: p.value,
      deseasonalized: deseason ? analyzed[i] : null,
      trend: yhat,
      ci_low: yhat - half,
      ci_high: yhat + half,
    };
  });

  return {
    variable,
    bbox,
    analyzed_series: deseason ? 'deseasonalized' : 'raw',
    series: points,
    stats,
    summary: summarize(stats, variable.units),
    synthetic,
    provider,
    warnings,
  };
}

/* ------------------------------------------------------------------ in-memory stores */

type StoredJob = { job: Job; startedAt: number; result?: AnalysisResult; error?: string };
const jobs = new Map<string, StoredJob>();
const uploads = new Map<string, { dataset: Dataset; raw: Raw }>();
let seq = 0;
const newId = (p: string) => `${p}_${Date.now().toString(36)}${(seq++).toString(36)}`;

const strip = (v: MockVariable): Variable => {
  const { base: _b, amp: _a, trend: _t, noise: _n, min: _m, fixedTrend: _f, ...rest } = v;
  return { ...rest, map_layer: mockMapLayer(v) };
};

function findVariable(id: string): MockVariable {
  const v = MOCK_VARIABLES.find((x) => x.id === id);
  if (!v) throw new MockError(`Unknown variable "${id}".`, 404);
  return v;
}

function validate(req: AnalysisRequest) {
  const b = req.bbox;
  if (!req.variable_id.startsWith(UPLOAD_PREFIX)) {
    const series = MOCK_VARIABLES.find((x) => x.id === req.variable_id)?.coverage === 'series';
    if (!b && !series) throw new MockError('bbox: Draw an area on the map first.', 422);
    if (!b) return checkDates(req);
    if (!(b.west < b.east && b.south < b.north)) throw new MockError('The area is invalid: west must be less than east and south less than north.', 422);
    if (b.west < -180 || b.east > 180 || b.south < -90 || b.north > 90) throw new MockError('The area is outside the globe. Longitudes run from -180 to 180, latitudes from -90 to 90.', 422);
  }
  checkDates(req);
}

function checkDates(req: AnalysisRequest) {
  if (!(req.start < req.end)) throw new MockError('The start date must be before the end date.', 422);
  const years = (parse(req.end).getTime() - parse(req.start).getTime()) / (365.25 * 864e5);
  const minYears = req.aggregation === 'annual' ? 5 : 2;
  if (years < minYears - 0.05)
    throw new MockError(`Pick at least ${minYears} years for ${req.aggregation} data: shorter periods can't separate a trend from noise.`, 422);
}

function runJob(stored: StoredJob) {
  const { request: req } = stored.job;
  try {
    if (req.variable_id.startsWith(UPLOAD_PREFIX)) {
      const up = uploads.get(req.variable_id.slice(UPLOAD_PREFIX.length));
      if (!up) throw new MockError('That uploaded dataset no longer exists. Upload it again.', 404);
      const raw = up.raw.filter((p) => p.date >= req.start && p.date <= req.end);
      const variable: Variable = {
        id: req.variable_id, name: up.dataset.name, units: up.dataset.units || 'units', sphere: 'land',
        short_definition: 'A dataset you uploaded.', why_it_matters: 'Your own question, same statistical tests.',
        source: 'Your upload', mission_or_model: 'Upload', product: up.dataset.name, temporal_resolution: 'monthly',
        available_start: up.dataset.start, available_end: up.dataset.end, coverage: 'series',
        dataset: up.dataset.name, access: 'Upload', location: null,
      };
      stored.result = analyze(variable, null, raw, req, 'upload', false);
    } else {
      const v = findVariable(req.variable_id);
      const start = req.start < v.available_start ? v.available_start : req.start;
      const end = req.end > v.available_end ? v.available_end : req.end;
      // Global records ignore the area: synthesize at the station (or a fixed global key).
      const isSeries = v.coverage === 'series';
      const loc = v.location;
      const genBox = isSeries ? (loc ? { west: loc.lon - 0.5, east: loc.lon + 0.5, south: loc.lat - 0.5, north: loc.lat + 0.5 } : { west: -1, east: 1, south: -1, north: 1 }) : req.bbox!;
      const result = analyze(strip(v), isSeries ? null : genBox, synthesize(v, genBox, start, end), req, 'synthetic', true);
      result.warnings.push('Demo data: these values are simulated, not real NASA measurements.');
      if (start !== req.start || end !== req.end)
        result.warnings.push(`Dates were trimmed to what ${v.mission_or_model} covers (${start} to ${end}).`);
      stored.result = result;
    }
  } catch (e) {
    stored.error = e instanceof Error ? e.message : 'The analysis failed.';
  }
}

function snapshot(stored: StoredJob): Job {
  const elapsed = Date.now() - stored.startedAt;
  const stage = Math.floor(elapsed / STAGE_MS);
  if (stage < STAGES.length) {
    const s = STAGES[stage];
    return { ...stored.job, status: s.status, message: s.message, progress: Math.min(0.95, elapsed / (STAGE_MS * STAGES.length)) };
  }
  if (!stored.result && !stored.error) runJob(stored);
  if (stored.error) return { ...stored.job, status: 'error', progress: 1, message: stored.error };
  return { ...stored.job, status: 'done', progress: 1, message: 'Done', result: stored.result ?? null };
}

function seriesCsv(r: AnalysisResult): string {
  const head = 'date,value,deseasonalized,trend,ci_low,ci_high';
  const cell = (x: number | null) => (x === null ? '' : String(x));
  return [head, ...r.series.map((p) => [p.date, p.value, p.deseasonalized, p.trend, p.ci_low, p.ci_high].map((c, i) => (i === 0 ? c : cell(c as number | null))).join(','))].join('\n');
}

function parseCsv(text: string): Raw {
  const lines = text.trim().split(/\r?\n/);
  const header = lines.shift()?.toLowerCase().replace(/\s/g, '');
  if (header !== 'date,value') throw new MockError('The CSV needs a header row "date,value".', 422);
  const out: Raw = [];
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    const [d, v] = line.split(',');
    const value = Number(v);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d?.trim() ?? '') || !Number.isFinite(value))
      throw new MockError(`Row ${i + 2} isn't "YYYY-MM-DD,number": "${line.slice(0, 40)}".`, 422);
    out.push({ date: d.trim(), value });
  });
  if (out.length < 8) throw new MockError('The CSV needs at least 8 rows to fit a trend.', 422);
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/* ------------------------------------------------------------------ the mock API */

export const mockApi: TrendApi = {
  async health() {
    return { status: 'ok', provider: 'mock', version: 'mock' };
  },
  async listVariables() {
    await delay(80);
    return MOCK_VARIABLES.map(strip);
  },
  async getVariable(id) {
    return strip(findVariable(id));
  },
  async listExamples() {
    await delay(80);
    return MOCK_EXAMPLES;
  },
  async createAnalysis(req) {
    validate(req);
    if (!req.variable_id.startsWith(UPLOAD_PREFIX)) findVariable(req.variable_id);
    const job: Job = { id: newId('job'), status: 'queued', progress: 0, message: 'Waiting to start', request: req, result: null, created_at: new Date().toISOString() };
    jobs.set(job.id, { job, startedAt: Date.now() });
    return job;
  },
  async getAnalysis(id) {
    const stored = jobs.get(id);
    if (!stored) throw new MockError('That analysis was not found. Run it again.', 404);
    return snapshot(stored);
  },
  async getAnalysisCsv(id) {
    const stored = jobs.get(id);
    if (!stored?.result) throw new MockError('The analysis has not finished yet.', 409);
    return seriesCsv(stored.result);
  },
  async uploadDataset(file, name, units) {
    const raw = parseCsv(await file.text());
    const dataset: Dataset = {
      id: newId('ds'),
      name: name?.trim() || file.name.replace(/\.csv$/i, ''),
      units: units?.trim() || '',
      n: raw.length,
      start: raw[0].date,
      end: raw[raw.length - 1].date,
      created_at: new Date().toISOString(),
    };
    uploads.set(dataset.id, { dataset, raw });
    return dataset;
  },
  async listDatasets() {
    return [...uploads.values()].map((u) => u.dataset);
  },
  async deleteDataset(id) {
    uploads.delete(id);
  },
  async getGrid(id, q) {
    await delay(60);
    return mockGrid(findVariable(id), q);
  },
  async getGridDates(id) {
    return mockGridDates(findVariable(id));
  },
  async geocode(q, limit) {
    await delay(120);
    if (q.trim().length < 2) throw new MockError('Type at least 2 characters.', 422);
    return mockGeocode(q, limit);
  },
  async chat(req: ChatRequest) {
    await delay(500);
    const ctx = req.context.result_summary
      ? ` You're looking at a result that says: "${req.context.result_summary}"`
      : req.context.bbox
        ? ' You have an area selected; pick a variable and run the analysis to get a verdict.'
        : ' Start by picking a place on the globe.';
    return {
      stub: true,
      message: {
        role: 'assistant',
        content: `I'm the field guide placeholder, so I can't really answer yet.${ctx} A teammate will connect the real assistant here soon.`,
      },
    };
  },
};
