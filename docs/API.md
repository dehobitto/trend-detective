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
  temporal_resolution: "daily" | "8-day" | "monthly"
  available_start: string    // date
  available_end: string      // date
  coverage: "global" | "land" | "ocean" | "series"
  // "series" = a ready-made single time series (station like Mauna Loa, or a global mean like NOAA marine CH4).
  // bbox is NOT needed/used for these; UI should skip the "draw an area" step and show a "Global record" note.
  dataset: string            // dataset name as the team uses it, e.g. "GLDAS_CLSM025_DA1_D v2.2"
  access: string             // how real data is obtained: "Giovanni" | "GES DISC OPeNDAP" | "Earthdata OPeNDAP" | "LAADS" | "NOAA GML"
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
  takeaway: null                         // always null: the AI field guide interprets each actual result
                                         // (frontend: features/results/AiInsight.tsx); kept for compatibility
}

type AnalysisRequest = {
  bbox: BBox | null          // required unless variable coverage is "series" or variable_id is "upload:<id>"
  variable_id: string        // or "upload:<dataset_id>" for user data (bbox ignored then)
  start: string
  end: string
  aggregation: "monthly" | "annual"     // default "monthly"
  deseasonalize: boolean                // default true for monthly
  alpha: number                         // significance level, default 0.05
  cells: BBox[] | null                  // optional, ≤600: a named region's squares (from /api/regions/shape);
                                        // the average covers only these. bbox should be their bounding box.
                                        // Ignored for "series" variables and uploads.
  region_name: string | null            // optional display name of that region, echoed in the result
}

type JobStatus = "queued" | "fetching" | "processing" | "analyzing" | "done" | "error"

type Job = {
  id: string
  status: JobStatus
  progress: number           // 0..1; while "fetching" from NASA it moves 0.10 → 0.45 with the download
  message: string | null     // human readable stage message or error message, e.g. while downloading:
                             // "Downloading from NASA: 340 of 1012 files. A new area takes a while the first time; after that it is instant."
  request: AnalysisRequest
  result: AnalysisResult | null
  preview: AnalysisResult | null  // while a big download runs (night lights over a large area): a preliminary
                             // result on the data so far, yearly points from the months already downloaded
                             // (October of every year first, then April, ...). warnings[0] says it is
                             // preliminary. Updated after every month pass; null when done or on error.
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
  provider: string           // concrete source: "earthdata" | "blackmarble" | "noaa_gml" | "upload" (all data is real; no demo data)
  region_name: string | null // set when the request averaged over a named region's cells
  warnings: string[]         // e.g. "Fewer than 10 years of data: trends may not be reliable."
                             // Notes from the data source come first, e.g. night lights over a large area:
                             // "This area is large, so night lights were sampled at one pixel in 36 (about one point every 3 km)…"
}

type Dataset = { id: string; name: string; units: string; n: number; start: string; end: string; created_at: string }

type ChatMessage = { role: "user" | "assistant"; content: string }
type ChatRequest = { messages: ChatMessage[]; context: { bbox: BBox | null; variable_id: string | null; result_summary: string | null } }
type ChatResponse = { message: ChatMessage; stub: boolean }   // stub: false = LLM field guide; its LLM failing -> 503 ApiError

type ApiError = { detail: string }   // FastAPI default shape; 4xx/5xx
```

## Endpoints

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/health` | – | `{ status: "ok", provider: string, version: string }` (provider = `TD_DATA_PROVIDER`, normally `"live"`) |
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

Validation (422): bbox must have west<east, south<north, within range, each side at least 0.05° (the map
UI enforces 0.25°: smaller rectangles are enlarged there); start<end; dates inside variable availability
(clamped with a warning); unknown variable → 404.

Frontend polls `GET /api/analyses/{id}` every ~400 ms until `done`/`error`. There is no fixed time limit: the
frontend gives up only when status, progress and message have not changed for 3 minutes
(`pollStallMs` in `frontend/src/config/app.ts`). How long a job takes:

- cached area (all example cases, from the committed seed): well under a second;
- new area, monthly products (GPM, MERRA-2, MODIS MOD11C3/MOD13C2, GLDAS sampled monthly): ~25–70 s;
- new area, OMI NO₂ (4 days per month): 2–4 min; night lights: ~2 min for a city, ~6 min for a 5°×5° area
  (big areas are sampled with a stride and say so in `warnings`). Night-light downloads of 200+ files show a
  preliminary yearly result (`Job.preview`) after the first month pass (a 20°×20° area, 672 files: first
  answer at ~75 s of ~7 min). Tile windows are cached on their own, so a moved box re-downloads only new tiles.

When a source fails, the job ends with `status: "error"` and a student-readable `message`. There is no
fallback data.

## v2 additions (map layers, time slider, place search)

```ts
// New field on Variable (null for "series" variables and area variables without a GIBS layer:
// merra2_bc, merra2_oc, merra2_so4, merra2_sulfate_aod):
map_layer: MapLayer | null

type MapLayer =
    { kind: "gibs"                    // real NASA imagery tiles from GIBS WMTS (EPSG:3857), time-enabled
      layer: string                   // GIBS layer identifier, verified against GetCapabilities
      tile_matrix_set: string         // e.g. "GoogleMapsCompatible_Level6"
      format: "png" | "jpeg"
      max_zoom: number
      time_step: "daily" | "8day" | "monthly" | "yearly"
      time_start: string; time_end: string   // dates available in GIBS
      legend_url: string | null       // GIBS legend image if available
      // tile URL template the frontend builds:
      // https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/{layer}/default/{time}/{tile_matrix_set}/{z}/{y}/{x}.{format}
    }

type Place = { name: string; display_name: string; lat: number; lon: number; bbox: BBox | null; kind: string
               osm: string | null }   // OpenStreetMap id ("R60199" relation, "W…" way, "N…" node) for /api/regions/shape

type RegionShape = {           // a named area (country, state, city) approximated by grid squares
  osm: string
  name: string
  kind: string
  outline: object              // simplified boundary, GeoJSON Polygon or MultiPolygon, for drawing
  cells: BBox[]                // squares the analysis averages over (≤300; send them as AnalysisRequest.cells)
  cell_deg: number             // square size: the smallest of 0.1, 0.25, 0.5, 1, 2, 3, 5° that needs ≤300 squares
  bbox: BBox                   // bounding box of the squares (send as AnalysisRequest.bbox)
}
```

| Method | Path | Query | Returns |
|---|---|---|---|
| GET | `/api/geocode` | `q` (≥2 chars), `limit` (default 6) | `Place[]` (proxied to OSM Nominatim/Photon with caching; generic User-Agent) |
| GET | `/api/regions/shape` | `osm` (a `Place.osm` id) | `RegionShape` (boundary from OSM Nominatim; a square is kept when the boundary covers ≥35% of it; regions wider than 90° or taller than 60° are refused with a readable `detail`) |

Globe overlay (frontend only): GIBS layers are fetched as one equirectangular image via WMS
`https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS={layer}&STYLES=&CRS=EPSG:4326&BBOX=-90,-180,90,180&WIDTH=2048&HEIGHT=1024&FORMAT=image/png&TRANSPARENT=TRUE&TIME={date}`.
The map and globe show only GIBS imagery; the backend serves no gridded values.

## Deployment notes

Production runs as one long-lived container (`Dockerfile`, see `docs/DEPLOY.md`): the same app serves the API
under `/api` and the built frontend at `/` (`TD_STATIC_DIR`; unknown non-`/api` paths return `index.html`,
unknown `/api/*` paths still return a JSON 404). The contract above is unchanged. Jobs and uploaded datasets
are kept in process memory / container disk, so they disappear on a redeploy or restart: a `GET
/api/analyses/{id}` or `/csv` for a job from before a restart returns 404, and the frontend should simply
re-run the analysis. Run a single worker process.

The data cache is empty on a fresh container, but the downloaded series for every example case are committed
in `backend/app/data/seed/cache/` and copied into the cache at startup, so the examples answer at once on a
new deploy, even if NASA is unreachable.
