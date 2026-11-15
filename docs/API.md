# API contract (v1) — backend and frontend MUST both follow this exactly

Base path: `/api`. JSON everywhere, snake_case keys. Dates are ISO `YYYY-MM-DD`. Times UTC.

## Shared types

```ts
type BBox = { west: number; south: number; east: number; north: number }   // degrees, lon -180..180, lat -90..90, west<east (no antimeridian crossing in v1)

type Sphere = "atmosphere" | "land" | "ocean" | "water"

type Variable = {
  id: string                 // e.g. "merra2_t2m"
  name: string               // "Surface air temperature"
  short_definition: string   // 1–2 sentences, plain language for students
  why_it_matters: string     // 1 sentence
  units: string              // "°C"
  sphere: Sphere
  source: string             // "MERRA-2 (model reanalysis)"
  mission_or_model: string   // "MERRA-2" | "MODIS" | "GPM" | "OMI" | "AIRS" | "GLDAS" ...
  product: string            // NASA product id, e.g. "M2TMNXSLV.5.12.4:T2M"
  temporal_resolution: "daily" | "monthly"
  available_start: string    // date
  available_end: string      // date
  coverage: "global" | "land" | "ocean" | "series"
  // "series" = a ready-made single time series (station like Mauna Loa, or a global mean like NOAA marine CH4).
  // bbox is NOT needed/used for these; UI should skip the "draw an area" step and show a "Global record" note.
  dataset: string            // dataset name as the team uses it, e.g. "GLDAS_CLSM025_DA1_D v2.2"
  access: string             // how real data is obtained: "Giovanni" | "AppEEARS" | "GES DISC OPeNDAP" | "KNMI Climate Explorer" | "NOAA GML"
  location: { lat: number; lon: number; label: string } | null   // for "series" from a station (Mauna Loa), else null
}

type ExampleCase = {
  id: string
  title: string              // "Is the Arctic warming faster?"
  question: string           // the detective question, 1 sentence
  bbox: BBox | null          // null for "series" variables
  variable_id: string
  start: string
  end: string
  deseasonalize: boolean
  center: { lat: number; lon: number }   // for globe fly-to
  related_variable_id: string | null     // optional "compare with" variable for the same region (e.g. groundwater vs rainfall)
  takeaway: string | null                // 1 sentence explaining what the pair/trend shows
}

type AnalysisRequest = {
  bbox: BBox | null          // required unless variable coverage is "series" or variable_id is "upload:<id>"
  variable_id: string        // or "upload:<dataset_id>" for user data (bbox ignored then)
  start: string
  end: string
  aggregation: "monthly" | "annual"     // default "monthly"
  deseasonalize: boolean                // default true for monthly
  alpha: number                         // significance level, default 0.05
}

type JobStatus = "queued" | "fetching" | "processing" | "analyzing" | "done" | "error"

type Job = {
  id: string
  status: JobStatus
  progress: number           // 0..1
  message: string | null     // human readable stage message or error message
  request: AnalysisRequest
  result: AnalysisResult | null
  created_at: string         // ISO datetime
}

type SeriesPoint = {
  date: string
  value: number | null       // raw area-mean (after aggregation)
  deseasonalized: number | null  // anomaly series if deseasonalize, else null
  trend: number | null       // fitted OLS trend value at this date (on the analyzed series)
  ci_low: number | null      // 95%(1-alpha) CI of the mean trend line
  ci_high: number | null
}

type TrendStats = {
  n: number
  slope_per_year: number
  slope_per_decade: number
  slope_ci_low_per_decade: number
  slope_ci_high_per_decade: number
  intercept: number
  r_squared: number
  t_stat: number
  p_value: number            // OLS two-sided t-test on slope
  mk_tau: number             // Mann-Kendall
  mk_z: number
  mk_p_value: number
  sens_slope_per_decade: number
  total_change: number       // slope * span in years
  percent_change: number | null  // total_change / |mean| * 100, null if mean ~ 0
  direction: "rising" | "falling" | "flat"
  significant: boolean       // mk_p_value < alpha AND p_value < alpha  (both agree)
  alpha: number
}

type AnalysisResult = {
  variable: Variable         // for uploads, a synthesized Variable
  bbox: BBox | null
  analyzed_series: "raw" | "deseasonalized"
  series: SeriesPoint[]
  stats: TrendStats
  summary: string            // plain-English verdict, e.g. "Rising by 0.42 °C per decade. Both tests agree this trend is significant (p < 0.001)."
  synthetic: boolean         // true when demo/synthetic data was used
  provider: string           // "synthetic" | "giovanni" | "upload"
  warnings: string[]         // e.g. "Fewer than 10 years of data: trends may not be reliable."
}

type Dataset = { id: string; name: string; units: string; n: number; start: string; end: string; created_at: string }

type ChatMessage = { role: "user" | "assistant"; content: string }
type ChatRequest = { messages: ChatMessage[]; context: { bbox: BBox | null; variable_id: string | null; result_summary: string | null } }
type ChatResponse = { message: ChatMessage; stub: boolean }

type ApiError = { detail: string }   // FastAPI default shape; 4xx/5xx
```

## Endpoints

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/health` | – | `{ status: "ok", provider: string, version: string }` |
| GET | `/api/variables` | – | `Variable[]` |
| GET | `/api/variables/{id}` | – | `Variable` (404 if unknown) |
| GET | `/api/examples` | – | `ExampleCase[]` |
| POST | `/api/analyses` | `AnalysisRequest` | `Job` (status `queued`, 202) |
| GET | `/api/analyses/{job_id}` | – | `Job` (404 if unknown) |
| GET | `/api/analyses/{job_id}/csv` | – | `text/csv` of `series` (409 if not done) |
| POST | `/api/datasets` | multipart `file` (CSV with header `date,value`), optional form fields `name`, `units` | `Dataset` (201). 422 with clear `detail` on bad CSV |
| GET | `/api/datasets` | – | `Dataset[]` |
| DELETE | `/api/datasets/{id}` | – | 204 |
| POST | `/api/chat` | `ChatRequest` | `ChatResponse` |

Validation (422): bbox must have west<east, south<north, within range, area not degenerate; start<end; dates
inside variable availability (clamp + warning is acceptable instead of erroring); unknown variable → 404.

Frontend polls `GET /api/analyses/{id}` every ~400 ms until `done`/`error`. Synthetic provider should
take a short artificial delay (~0.3 s per stage, configurable `TD_SYNTHETIC_DELAY`) so the progress UI is
visible.

## v2 additions (map layers, time slider, place search)

```ts
// New field on Variable:
map_layer: MapLayer | null

type MapLayer =
  | { kind: "gibs"                    // real NASA imagery tiles from GIBS WMTS (EPSG:3857), time-enabled
      layer: string                   // GIBS layer identifier, verified against GetCapabilities
      tile_matrix_set: string         // e.g. "GoogleMapsCompatible_Level6"
      format: "png" | "jpeg"
      max_zoom: number
      time_step: "daily" | "8day" | "monthly" | "yearly"
      time_start: string; time_end: string   // dates available in GIBS
      legend_url: string | null       // GIBS colormap legend image if available
      // tile URL template the frontend builds:
      // https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/{layer}/default/{time}/{tile_matrix_set}/{z}/{y}/{x}.{format}
    }
  | { kind: "grid" }                  // backend serves gridded values via /api/grid (synthetic now, real later)

type Colormap = { name: string; stops: [number, string][] }   // value -> hex, for legend + client rendering

type GridFrame = {
  variable_id: string
  date: string                        // first day of month
  bbox: BBox                          // area actually covered
  width: number; height: number       // grid size (cols, rows); row 0 = north
  values: (number | null)[]           // row-major, length width*height, null = no data (e.g. ocean for land vars)
  min: number; max: number            // suggested color range for this variable (stable across frames)
  units: string
  colormap: Colormap
  synthetic: boolean
}

type Place = { name: string; display_name: string; lat: number; lon: number; bbox: BBox | null; kind: string }
```

| Method | Path | Query | Returns |
|---|---|---|---|
| GET | `/api/grid/{variable_id}` | `date=YYYY-MM-01`, `west,south,east,north` (optional; default global), `res` (deg, optional; server caps size to ≤ 200×200) | `GridFrame` |
| GET | `/api/grid/{variable_id}/dates` | – | `string[]` monthly dates available for the slider |
| GET | `/api/geocode` | `q` (≥2 chars), `limit` (default 6) | `Place[]` (proxied to OSM Nominatim/Photon with caching; generic User-Agent) |

## v3 additions (change maps)

| Method | Path | Query | Returns |
|---|---|---|---|
| GET | `/api/grid/{variable_id}` | add `mode=value|anomaly` (default value). anomaly = value minus that calendar month's climatology over the variable's availability; diverging colormap centered on 0, symmetric min/max | `GridFrame` |
| GET | `/api/grid/{variable_id}/trend` | `start`, `end` (YYYY-MM-01), optional bbox, `res`, `alpha` (0.05) | `TrendGrid` |

```ts
type TrendGrid = GridFrame & {           // values = slope per decade (on deseasonalized monthly series) per cell
  date: string                           // = end
  start: string; end: string
  significant: (boolean | null)[]        // per cell, Mann-Kendall p < alpha (same length as values)
  // units = "<variable units> per decade"; colormap diverging: falling = deep blue #07668A side, rising = ochre #9A5200 side, 0 = neutral light
}
```
Globe overlay (frontend only): GIBS layers are fetched as one equirectangular image via WMS
`https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS={layer}&STYLES=&CRS=EPSG:4326&BBOX=-90,-180,90,180&WIDTH=2048&HEIGHT=1024&FORMAT=image/png&TRANSPARENT=TRUE&TIME={date}`;
grid/anomaly/trend frames are rendered to a canvas texture from a global GridFrame.
