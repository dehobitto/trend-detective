/** Mirrors docs/API.md (v1) exactly. Keep in sync with backend/app/schemas. */

export type BBox = { west: number; south: number; east: number; north: number };

export type Sphere = 'atmosphere' | 'land' | 'ocean' | 'water';

export type Variable = {
  id: string;
  name: string;
  short_definition: string;
  why_it_matters: string;
  units: string;
  sphere: Sphere;
  source: string;
  mission_or_model: string;
  product: string;
  temporal_resolution: 'daily' | 'monthly';
  available_start: string;
  available_end: string;
  /** "series" = a ready-made single time series (station or global mean): no bbox needed. */
  coverage: 'global' | 'land' | 'ocean' | 'series';
  /** Dataset name as the team uses it, e.g. "GLDAS_CLSM025_DA1_D v2.2". */
  dataset: string;
  /** How real data is obtained: "Giovanni" | "AppEEARS" | "GES DISC OPeNDAP" | "KNMI Climate Explorer". */
  access: string;
  /** Station location for station series (Mauna Loa), else null. */
  location: { lat: number; lon: number; label: string } | null;
};

export type ExampleCase = {
  id: string;
  title: string;
  question: string;
  bbox: BBox | null;
  variable_id: string;
  start: string;
  end: string;
  deseasonalize: boolean;
  center: { lat: number; lon: number };
  /** Optional "compare with" variable for the same region (e.g. groundwater vs rainfall). */
  related_variable_id: string | null;
  /** One sentence explaining what the pair/trend shows. */
  takeaway: string | null;
};

export type Aggregation = 'monthly' | 'annual';

export type AnalysisRequest = {
  /** Required unless the variable's coverage is "series" or variable_id is "upload:<id>". */
  bbox: BBox | null;
  variable_id: string;
  start: string;
  end: string;
  aggregation: Aggregation;
  deseasonalize: boolean;
  alpha: number;
};

export type JobStatus = 'queued' | 'fetching' | 'processing' | 'analyzing' | 'done' | 'error';

export type Job = {
  id: string;
  status: JobStatus;
  progress: number;
  message: string | null;
  request: AnalysisRequest;
  result: AnalysisResult | null;
  created_at: string;
};

export type SeriesPoint = {
  date: string;
  value: number | null;
  deseasonalized: number | null;
  trend: number | null;
  ci_low: number | null;
  ci_high: number | null;
};

export type TrendStats = {
  n: number;
  slope_per_year: number;
  slope_per_decade: number;
  slope_ci_low_per_decade: number;
  slope_ci_high_per_decade: number;
  intercept: number;
  r_squared: number;
  t_stat: number;
  p_value: number;
  mk_tau: number;
  mk_z: number;
  mk_p_value: number;
  sens_slope_per_decade: number;
  total_change: number;
  percent_change: number | null;
  direction: 'rising' | 'falling' | 'flat';
  significant: boolean;
  alpha: number;
};

export type AnalysisResult = {
  variable: Variable;
  bbox: BBox | null;
  analyzed_series: 'raw' | 'deseasonalized';
  series: SeriesPoint[];
  stats: TrendStats;
  summary: string;
  synthetic: boolean;
  provider: string;
  warnings: string[];
};

export type Dataset = {
  id: string;
  name: string;
  units: string;
  n: number;
  start: string;
  end: string;
  created_at: string;
};

export type ChatMessage = { role: 'user' | 'assistant'; content: string };
export type ChatRequest = {
  messages: ChatMessage[];
  context: { bbox: BBox | null; variable_id: string | null; result_summary: string | null };
};
export type ChatResponse = { message: ChatMessage; stub: boolean };

export type ApiError = { detail: string };

export type Health = { status: 'ok'; provider: string; version: string };

/** The full surface of the backend. Implemented by the HTTP client and by the in-browser mock. */
export interface TrendApi {
  health(): Promise<Health>;
  listVariables(): Promise<Variable[]>;
  getVariable(id: string): Promise<Variable>;
  listExamples(): Promise<ExampleCase[]>;
  createAnalysis(req: AnalysisRequest): Promise<Job>;
  getAnalysis(jobId: string): Promise<Job>;
  getAnalysisCsv(jobId: string): Promise<string>;
  uploadDataset(file: File, name?: string, units?: string): Promise<Dataset>;
  listDatasets(): Promise<Dataset[]>;
  deleteDataset(id: string): Promise<void>;
  chat(req: ChatRequest): Promise<ChatResponse>;
}

export const UPLOAD_PREFIX = 'upload:';

export const isSeriesVariable = (v: Variable | undefined | null) => v?.coverage === 'series';
