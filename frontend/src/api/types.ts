/** Mirrors docs/API.md (v1 + v2 additions) exactly. Keep in sync with backend/app/schemas. */

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
  temporal_resolution: 'daily' | '8-day' | 'monthly';
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
  /** NASA GIBS imagery for the map / globe; null = no map imagery (still analysable by drawing a box). */
  map_layer: MapLayer | null;
};

/* ------------------------------------------------------------------ map layers, geocode */

export type TimeStep = 'daily' | '8day' | 'monthly' | 'yearly';

export type GibsLayer = {
  kind: 'gibs';
  /** GIBS layer identifier (EPSG:3857 "best"). */
  layer: string;
  /** e.g. "GoogleMapsCompatible_Level6". */
  tile_matrix_set: string;
  format: 'png' | 'jpeg';
  max_zoom: number;
  time_step: TimeStep;
  time_start: string;
  time_end: string;
  legend_url: string | null;
};

export type MapLayer = GibsLayer;

export type Place = { name: string; display_name: string; lat: number; lon: number; bbox: BBox | null; kind: string; osm?: string | null };

/** A named area's OSM boundary approximated by grid squares (GET /api/regions/shape). */
export type RegionShape = {
  osm: string;
  name: string;
  kind: string;
  /** Simplified boundary, GeoJSON Polygon or MultiPolygon geometry. */
  outline: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  /** The squares the analysis averages over. */
  cells: BBox[];
  cell_deg: number;
  bbox: BBox;
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
  /** A named region's squares: the average covers only these (bbox = their bounding box). */
  cells?: BBox[] | null;
  region_name?: string | null;
};

export type JobStatus = 'queued' | 'fetching' | 'processing' | 'analyzing' | 'done' | 'error';

export type Job = {
  id: string;
  status: JobStatus;
  progress: number;
  message: string | null;
  request: AnalysisRequest;
  result: AnalysisResult | null;
  /** While a big download runs: a preliminary result on the data so far (warnings[0] says so). */
  preview?: AnalysisResult | null;
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
  mk_tau: number;
  mk_z: number;
  mk_p_value: number;
  total_change: number;
  percent_change: number | null;
  direction: 'rising' | 'falling' | 'flat';
  significant: boolean;
  alpha: number;
};

export type TestRow = {
  name: string;
  estimate: number | null;
  p_value: number | null;
  direction: 'up' | 'down' | 'none' | null;
  significant: boolean | null;
  /** False: shown for reference, not counted in the verdict. */
  voting: boolean;
};

/** Trend significance check (Mann-Kendall TFPW + sensitivity analysis). */
export type TrendAssessment = {
  verdict: 'significant_up' | 'significant_down' | 'not_significant' | 'ambiguous' | 'insufficient_data';
  confidence: 'low' | 'medium' | 'high';
  tests_significant: number;
  tests_voting: number;
  robust_same_sign: number | null;
  robust_significant: number | null;
  tests: TestRow[];
};

export type AnalysisResult = {
  variable: Variable;
  bbox: BBox | null;
  analyzed_series: 'raw' | 'deseasonalized';
  series: SeriesPoint[];
  stats: TrendStats;
  summary: string;
  provider: string;
  warnings: string[];
  /** Set when the analysis averaged over a named region's squares. */
  region_name?: string | null;
  assessment?: TrendAssessment | null;
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

/** The full surface of the backend. Implemented by the HTTP client. */
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
  geocode(q: string, limit?: number, signal?: AbortSignal): Promise<Place[]>;
  getRegionShape(osm: string): Promise<RegionShape>;
}

export const UPLOAD_PREFIX = 'upload:';

export const isSeriesVariable = (v: Variable | undefined | null) => v?.coverage === 'series';

/* ------------------------------------------------------------------ phenomena (multi-variable investigations) */

export type VariableExpectation = {
  variable_id: string;
  /** What the phenomenon predicts for this variable. */
  expect: 'significant_up' | 'significant_down' | 'not_significant';
  /** Short label shown next to the variable name. */
  expect_label: string;
  /** One-line explanation of why this variable matters for the phenomenon. */
  role: string;
};

export type Phenomenon = {
  id: string;
  name: string;
  /** Short tagline shown in the picker list. */
  tagline: string;
  /** What the phenomenon claims (shown in the results header). */
  hypothesis: string;
  /** Detailed description of the phenomenon. */
  description: string;
  variables: VariableExpectation[];
  /** True when all variables are global series (no area needed). */
  global: boolean;
};
