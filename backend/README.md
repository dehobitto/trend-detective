# Trend Detective — backend

FastAPI service that turns *(region, Earth-science variable, dates)* into a time series plus trend
statistics (OLS + t-test + confidence intervals, Mann-Kendall, Sen's slope) and a plain-English verdict.
The API contract is [`../docs/API.md`](../docs/API.md); architecture is in [`../docs/SPEC.md`](../docs/SPEC.md).

All data is real (default `TD_DATA_PROVIDER=live`; there is no demo data). Each variable is routed by its
catalog `access`: GES DISC products (GLDAS, GPM IMERG, OMI NO₂, MERRA-2) and MODIS monthly land surface
temperature and NDVI (LP DAAC) via OPeNDAP (`earthdata`), VIIRS Black Marble night lights via LAADS OPeNDAP
(`blackmarble`), the three greenhouse-gas records (Mauna Loa CO₂, global marine CO₂ and CH₄) from NOAA GML
(`noaa_gml`). NASA sources need an Earthdata login (see
"Environment variables"); when a source fails, the analysis fails with a readable message instead of
falling back to anything.

## Catalog: the team's datasets

`app/catalog/variables.yaml` lists the variables the team uses (source of truth: the team's
"Датасети та змінні" list). `GET /api/variables` returns them; ids below.

| Dataset | Variables (catalog id → product variable) | Units shown | Coverage | Access |
|---|---|---|---|---|
| GLDAS_CLSM025_DA1_D v2.2 (daily, 0.25°, 2003-02 →) | `gldas_gws` → GWS_tavg, `gldas_tws` → TWS_tavg | mm | land | Giovanni |
| OMNO2d v004 (daily, 0.25°, 2004-10 →) | `omi_no2` → ColumnAmountNO2TropCloudScreened | 10¹⁵ molecules/cm² (from molecules/cm²) | global | Giovanni |
| MODIS MOD11C3 v061 (monthly, 0.05°, 2000-03 →) | `modis_lst_day` → LST_Day_CMG, `modis_lst_night` → LST_Night_CMG | °C (from K) | land | Earthdata OPeNDAP |
| MODIS MOD13C2 v061 (monthly, 0.05°, 2000-02 →) | `modis_ndvi` → CMG_0_05_Deg_Monthly_NDVI | unitless | land | Earthdata OPeNDAP |
| VIIRS Black Marble VNP46A3 v002 (monthly, 15″ ≈ 500 m, 2012-01 →) | `viirs_night_lights` → NearNadir_Composite_Snow_Free | nW/cm²/sr | land | LAADS |
| MERRA-2 M2TMNXAER v5.12.4 (monthly, 1980 →) | `merra2_dust` DUSMASS, `merra2_bc` BCSMASS, `merra2_oc` OCSMASS, `merra2_so2` SO2SMASS, `merra2_so4` SO4SMASS | µg/m³ (from kg/m³) | global | Giovanni |
| | `merra2_aod` TOTEXTTAU, `merra2_sulfate_aod` SUEXTTAU | unitless | global | Giovanni |
| GPM_3IMERGM v07 (monthly, 0.1°, 2000-06 →) | `gpm_precipitation` → precipitation | mm/day (from mm/hr) | global | Giovanni |
| Mauna Loa CO₂ (NOAA/Scripps, 1958-03 → 2026-09) | `mauna_loa_co2` | ppm | series | NOAA GML |
| Global marine CO₂ (NOAA, 1979-01 → 2026-07) | `noaa_co2_marine` | ppm | series | NOAA GML |
| Global marine CH₄ (NOAA, 1983-07 → 2026-06) | `noaa_ch4_marine` | ppb | series | NOAA GML |

The `available_end` of the three NOAA records is the latest month in NOAA's files when last checked
(2026-11); bump it in `variables.yaml` when the files gain months.

Water vapor and ozone are not in the catalog yet (the team has not picked datasets); a commented TODO
block at the end of `variables.yaml` shows where they go.

- **`coverage: "series"`** = one ready-made record (a station or a global mean). The request `bbox` may be
  omitted; if sent it is ignored (with a warning) and `result.bbox` is `null`. Mauna Loa has a `location`.
- **Daily and 8-day products are served as monthly area means**: aggregation (days → calendar months, grid
  cells → bbox mean) happens inside the provider, so the pipeline always receives a monthly series.
- **Unit conversion** from the native product units is stored per variable in the internal `conversion`
  block (`value * scale + offset`, applied with `CatalogVariable.to_catalog_units`).
- `examples.yaml` holds the one-click detective cases, each with an optional `related_variable_id`
  ("compare with", e.g. Punjab groundwater vs. rainfall); `takeaway` is always null (the AI field guide
  interprets the actual result instead). 10 cases: Punjab
  groundwater / rain, Delhi NO₂, China sulfate haze (vs. SO₂), Phoenix nights (vs. days), Mauna Loa CO₂,
  global methane, Rondônia forest (NDVI), Sahel greening (NDVI vs. rainfall) and Delhi night lights (vs. NO₂).
  What the real data shows for each case's default dates is in `NIGHT_NOTES.md` (useful context for the AI).

## Run

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env                # then fill in your Earthdata login
.venv/bin/uvicorn app.main:app --reload --port 8000
```

Or from the repo root: `./start.sh` (installs what is missing, starts backend and frontend; `--test` runs the
checks). The example cases work at once without any download: their series are committed in
`app/data/seed/cache/`. After changing a case or adding one:

```bash
.venv/bin/python -m app.prefetch              # download what the cases need into data/cache/
.venv/bin/python -m app.prefetch --save-seed  # copy it into app/data/seed/cache/, then commit
```

Interactive docs: http://localhost:8000/docs. Tests: `.venv/bin/python -m pytest` (no network: the app
tests use a test-only `fake` provider from `tests/fakes.py`, never used by the app; NOAA tests use the
trimmed files in `tests/fixtures/`, Earthdata/AppEEARS/geocoding tests stub httpx).

## Environment variables

All settings live in `app/config.py` and can be overridden with `TD_`-prefixed variables (or a `.env` file).

| Variable | Default | Meaning |
|---|---|---|
| `TD_DATA_PROVIDER` | `live` | `live`: route each variable to its real source by `access` (`earthdata`, `blackmarble`, `noaa_gml`), no fallback; or a single provider name |
| `TD_CHAT_BACKEND` | `stub` | `stub` (canned replies) or `fieldguide` (LLM field guide, see below) |
| `TD_CHAT_PROVIDER` | `openai` | LLM behind `fieldguide`: `openai` or `gemini` |
| `TD_CHAT_MODEL` | unset | Model id override (defaults: `gpt-5-mini`, `gemini-flash-latest`) |
| `OPENAI_API_KEY` / `GEMINI_API_KEY` | unset | LLM key (also `TD_`-prefixed). Without the provider's key, `fieldguide` falls back to the stub. Never commit it |
| `TD_CORS_ORIGINS` | `["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173"]` | JSON list of allowed origins |
| `TD_CACHE_DIR` | `backend/data/cache` | Downloaded data (gitignored); NOAA files in `noaa_gml/`, granule lists and monthly area means in `earthdata/` and `blackmarble/` |
| `TD_CACHE_SEED_DIR` | `backend/app/data/seed/cache` | Committed area means for the example cases, copied into `TD_CACHE_DIR` at startup (never over existing files). Empty value disables it |
| `TD_EARTHDATA_TOKEN` | unset | NASA Earthdata Login bearer token (also read as `EARTHDATA_TOKEN`). Never commit it |
| `TD_EARTHDATA_USERNAME` / `TD_EARTHDATA_PASSWORD` | unset | Earthdata login (also `EARTHDATA_USERNAME`/`EARTHDATA_USER`, `EARTHDATA_PASSWORD`/`EARTHDATA_PASS`, the team's `.env` names). Template: `backend/.env.example`. Verified with username + password and a token set together: GES DISC, LP DAAC and LAADS all work |
| `TD_EARTHDATA_WORKERS` | `16` | Parallel OPeNDAP requests per analysis (8 → 16 cut a new-area GLDAS fetch from 40 s to 26 s; more barely helps, NASA's per-request latency dominates) |
| `TD_APPEEARS_WAIT` / `TD_APPEEARS_POLL` | `90` / `10` | Only for the unused `appeears` provider |
| `TD_NOAA_CACHE_TTL_DAYS` | `7` | A cached NOAA file older than this is downloaded again (stale copy used if that fails) |
| `TD_NOAA_GML_BASE_URL` | `https://gml.noaa.gov/webdata/ccgg/trends` | Where `<gas>/<file>.txt` are downloaded from |
| `TD_HTTP_TIMEOUT` | `30` | Seconds before a data download gives up |
| `TD_NOAA_SEED_DIR` | `backend/app/data/seed/noaa_gml` | Committed NOAA files used when nothing is cached and NOAA is unreachable (copied into the cache) |
| `TD_UPLOAD_DIR` | `backend/data/uploads` | Where uploaded CSV datasets are stored |
| `TD_MAX_UPLOAD_BYTES` | `5242880` | Upload size limit |
| `TD_STATIC_DIR` | unset | Built frontend (`frontend/dist`) served at `/` with index.html fallback; set by the Docker image (`docs/DEPLOY.md`) |
| `TD_MAX_JOBS` | `500` | In-memory job history size |
| `TD_PHOTON_URL` | `https://photon.komoot.io/api/` | Place search, tried first |
| `TD_NOMINATIM_URL` | `https://nominatim.openstreetmap.org/search` | Place search fallback (jsonv2) |
| `TD_GEOCODE_TIMEOUT` | `6` | Seconds before a place-search request gives up |
| `TD_GEOCODE_CACHE_TTL` | `86400` | Seconds a place-search answer stays in the in-memory cache |
| `TD_NOMINATIM_MIN_INTERVAL` | `1` | At most one Nominatim request per this many seconds (usage policy) |

## Layout

```
app/
  main.py          create_app() factory: settings -> services -> routers, CORS, error format
  config.py        Settings (TD_ env prefix)
  prefetch.py      `python -m app.prefetch`: fill the caches for every example case
  api/             routers: health, catalog (variables/examples), analyses, datasets, chat, geocode;
                   deps.Services
  schemas/         pydantic models mirroring docs/API.md (geocode.py: Place)
  catalog/         variables.yaml, examples.yaml, loader (validated at startup)
  geocode.py       Photon -> Nominatim place search with TTL cache and Nominatim rate limit
  seed.py          install the committed real-data seed into the cache at startup; export it (`prefetch --save-seed`)
  regions.py       named areas: OSM boundary (Nominatim lookup) -> grid squares + simplified outline
  data/            seed/noaa_gml/ (committed NOAA CO₂/CH₄ files, offline fallback for the NOAA provider),
                   seed/cache/ (committed area means for every example case: earthdata/, blackmarble/)
  tools/           gibs_layers.py (refresh GIBS map layers)
  providers/       base.py (DataProvider protocol + registry, Route), upload.py (user CSVs),
                   noaa_gml.py (CO₂/CH₄ records), earthdata.py (GLDAS / GPM / OMI / MERRA-2 via GES DISC
                   OPeNDAP, MODIS MOD11C3 / MOD13C2 via LP DAAC OPeNDAP), blackmarble.py (VIIRS night lights
                   via LAADS OPeNDAP), appeears.py (MODIS 1 km via AppEEARS; not used by the catalog),
                   live.py (`live`: route a variable to a provider by its `access` field)
  processing/      timeseries.py, preprocess.py, trends.py, summary.py (pure functions, unit tested)
  jobs/            store.py (JobStore protocol + in-memory store), resolve.py (validation, bbox rules, date clamping), runner.py
  chat/            ChatBackend protocol + registry, StubChatBackend
tests/             pytest: trends, processing, catalog, API (via the test-only `fake` provider in fakes.py),
                   NOAA GML parsing/cache/fallback (fixtures/ = trimmed NOAA files), earthdata, appeears, geocoding
```

Analysis pipeline (`jobs/runner.py`): `resolve` (variable, provider via `route()`, clamped dates) → `provider.fetch`
(monthly area mean; download progress goes to the job via `fetch_progress`; notes the provider puts in
`series.attrs["notes"]` become the first `warnings`; a `ProviderError` ends the job with its message) → aggregate (monthly/annual) → `preprocess` (gap fill, deseasonalize) → `trends.analyze`
→ `build_summary`. Job status goes `queued → fetching → processing → analyzing → done | error`.

Notes on the numbers:
- Time is measured in decimal years; `intercept` is the fitted value at the first date of the series.
- With `deseasonalize`, the trend is fitted to monthly anomalies (value minus that calendar month's expected
  value), so `trend`/`ci_low`/`ci_high` in `series` are on the anomaly scale. The seasonal cycle comes from a
  classical decomposition: a centered 2x12 moving average removes the trend first, then the detrended values
  are averaged per calendar month (so a rising record does not make December look seasonally high). Records
  with fewer than 3 detrended values per month fall back to raw monthly means.
- `significant` requires both the OLS t-test and Mann-Kendall to have p < alpha.
- `direction` is the sign of the OLS slope, or `flat` when the total change is < 5% of the series' std-dev.
- `percent_change` is relative to the mean raw value; it is `null` for temperatures (°C has no true zero).

## Map: GIBS layers, place search (API v2)

Area variables with a GIBS layer have a public `map_layer` (`docs/API.md`, "v2 additions"); `series`
variables and the area variables listed last below have `null` (no map imagery; the analysis still works).

**GIBS imagery** (`kind: gibs`): real NASA tiles for the map time slider, chosen from the GIBS WMTS
GetCapabilities for EPSG:3857 (monthly layers preferred) and verified by downloading tiles. `time_start`/
`time_end` are what GIBS serves (not the product's availability); GIBS has gaps inside some ranges: GRACE has
nothing for 2017-07 → 2018-05 (between GRACE and GRACE-FO) and misses single months (e.g. 2016-04), where GIBS
answers tile requests with 404, so the frontend should keep the previous frame or show "no image".

| Variable | GIBS layer | Step | GIBS range | Note |
|---|---|---|---|---|
| `gldas_gws` | `GRACE_Tellus_Liquid_Water_Equivalent_Thickness_Mascon_CRI` | monthly | 2002-04 → 2022-07 | GRACE total water storage anomaly (closest to groundwater; no GLDAS GWS layer) |
| `gldas_tws` | `GRACE_Tellus_Liquid_Water_Equivalent_Thickness_Mascon_CRI` | monthly | 2002-04 → 2022-07 | what GRACE measures |
| `gpm_precipitation` | `MERRA2_Precipitation_Bias_Corrected_Monthly` | monthly | 1980-01 → 2026-08 | no IMERG monthly layer (IMERG is daily/30-min only) |
| `omi_no2` | `OMI_Nitrogen_Dioxide_Tropo_Column` | daily | 2004-10 → 2026-11 | no monthly OMI NO₂ layer |
| `merra2_dust` | `MERRA2_Dust_Surface_Mass_Concentration_Monthly` | monthly | 1980-01 → 2026-08 | exact variable (DUSMASS) |
| `merra2_so2` | `MERRA2_SO2_Column_Mass_Density_Monthly` | monthly | 1980-01 → 2026-08 | column, not surface, SO₂ (same pattern; legend in column units) |
| `merra2_aod` | `MERRA2_Total_Aerosol_Optical_Thickness_550nm_Extinction_Monthly` | monthly | 1980-01 → 2026-08 | exact variable (TOTEXTTAU) |
| `modis_lst_day` | `MODIS_Terra_L3_Land_Surface_Temp_Monthly_Day` | monthly | 2000-03 → 2026-10 | monthly MOD11C3 imagery, same product as the data |
| `modis_lst_night` | `MODIS_Terra_L3_Land_Surface_Temp_Monthly_Night` | monthly | 2000-03 → 2026-10 | monthly MOD11C3 imagery, same product as the data |
| `modis_ndvi` | `MODIS_Terra_L3_NDVI_Monthly` | monthly | 2000-03 → 2026-10 | `GoogleMapsCompatible_Level7`, max zoom 7 |
| `merra2_bc`, `merra2_oc`, `merra2_so4`, `merra2_sulfate_aod` | – (`map_layer: null`) | | | no GIBS layer for these MERRA-2 species |

All others use `GoogleMapsCompatible_Level6` (max zoom 6), PNG, with GIBS's horizontal SVG legend as `legend_url`.
Refresh after GIBS changes: `.venv/bin/python -m app.tools.gibs_layers` (prints suggested `map_layer` blocks
and checks a tile per layer; `--search no2` lists matching layers; `--no-verify` skips tile downloads),
then paste into `variables.yaml`. Preferences per variable live in `CANDIDATES` in that script.

**Place search** (`GET /api/geocode?q=&limit=6`): proxies Photon (`photon.komoot.io`), falling back to
OSM Nominatim when Photon fails or finds nothing. Generic User-Agent `TrendDetective/0.1 (hackathon demo)`,
6 s timeout, in-memory TTL cache (24 h, 1000 queries), at most 1 request/s to Nominatim. Results map to
`Place` (`bbox` from Photon `extent` / Nominatim `boundingbox`; tiny extents are padded to a valid BBox, ones
crossing the 180° line become `null`). 502 with a readable `detail` when both fail; 422 when `q` < 2 chars.

## Real data: NOAA GML greenhouse-gas records

`providers/noaa_gml.py` serves every catalog variable whose `product` is `NOAA-GML:<file>` from
`https://gml.noaa.gov/webdata/ccgg/trends/<gas>/<file>.txt` (`co2/co2_mm_mlo`, `co2/co2_mm_gl`,
`ch4/ch4_mm_gl`; public, no auth). It parses column 4 (the monthly mean, "average"; values ≤ -9 such as
`-9.99`/`-99.99` are missing), returns a complete month-start series, and caches the raw file in
`TD_CACHE_DIR/noaa_gml/` for `TD_NOAA_CACHE_TTL_DAYS`. If a refresh fails, the stale copy is used; with no
cached copy the committed seed in `app/data/seed/noaa_gml/` is used (`TD_NOAA_SEED_DIR`); with neither, the
job fails with "Couldn't reach NOAA to download the data. Please try again later."

Routing (`providers/live.py`): `live` implements `route(variable) -> Route(provider)`; `jobs/resolve.py`
uses it so the result reports the concrete provider (`earthdata`, `blackmarble`, `noaa_gml`).
`ACCESS_TO_PROVIDER` maps `access` values to providers.

## Real NASA data over OPeNDAP (`earthdata`, `blackmarble`)

`earthdata` (`providers/earthdata.py`) is the team's OPeNDAP data-access code
(github.com/evheniikozlov/nasa2026, `data_access.py`) behind our provider interface. Granule list from CMR
(public, cached per year), one DAP4 subset request per granule for just the bbox cells, cos(lat) area mean,
monthly mean, catalog units; results cached per grid box in `TD_CACHE_DIR/earthdata/`. Products and grids
are in `GRIDS`:

| Product | Grid | Sampling | New area, whole record |
|---|---|---|---|
| GLDAS_CLSM025_DA1_D (daily) | 0.25° | 1st of each month (groundwater changes slowly) | ~25–40 s |
| OMNO2d (daily) | 0.25° | 1st, 8th, 15th, 22nd (clouds blank many days) | 2–4 min |
| GPM_3IMERGM, M2TMNXAER (monthly) | 0.1°, 0.5°×0.625° | every month | ~25–30 s |
| MOD11C3, MOD13C2 (monthly, LP DAAC cloud OPeNDAP) | 0.05°, rows north → south | every month | ~30–70 s |

Details worth knowing before touching it:
- MODIS grids run north → south (`lat_step` < 0); `cell_range` mirrors them. Dimensions are named
  `YDim_<grid>` / `XDim_<grid>`.
- MOD13C2 NDVI files say `scale_factor = 10000` but mean *divide* (HDF4 MODIS convention): `Grid.packing`
  overrides it with 1e-4. LST's 0.02 is a real multiplier and comes from the file.
- Cell index math is rounded before floor/ceil, so a box edge exactly on a cell edge does not pull in the
  neighbouring cell.
- Downloads report progress (`report_progress`), which the job shows as "Downloading from NASA: N of M files".

`blackmarble` (`providers/blackmarble.py`) reads VIIRS VNP46A3 from LAADS OPeNDAP per 10° tile (2400×2400
pixels of 15″) and combines the tiles. A month is capped at `MAX_SAMPLES` = 40 000 pixels: bigger areas take
every Nth row and column (`[start:stride:stop]`), the stride goes into the cache key, and the result carries a
note ("sampled at one pixel in 36, about one point every 3 km; trend reliable, brightness approximate"). A city
keeps every pixel (~2 min for Delhi); a 5°×5° area (4 tiles, stride 6) takes ~6 min, because the time is set by
the number of requests (tiles × months), not their size. CMR lists VNP46A3 as version `2`, not `002`.

Named areas (`app/regions.py`, `GET /api/regions/shape`): the analysis sends the region's squares as
`cells`; providers average only the grid cells (or night-light pixels) whose centres fall inside them, and the
mask goes into the cache key.

**Earthdata account setup** (once per account, in the browser): approve the "NASA GESDISC DATA ARCHIVE"
application; for night lights also fill in *User Type*, *Organization* and *Study Area* in the Earthdata
profile and approve "LAADS Web" (LAADS refuses with `access_denied` otherwise). LP DAAC (MODIS) needed nothing
extra.

`appeears` (`providers/appeears.py`) is kept but no catalog variable uses it: AppEEARS area tasks give 1 km
MODIS (MOD11A2, MOD13A3) as a small statistics CSV, but during the hackathon its queue took hours per task. It
keeps a task through network errors and reuses a queued task with the same name instead of submitting again.

| Provider | File | Serves (`access`) | Route |
|---|---|---|---|
| `earthdata` | `providers/earthdata.py` | GLDAS, OMNO2d, MERRA-2, GPM IMERG (`Giovanni`, `GES DISC OPeNDAP`), MODIS MOD11C3 / MOD13C2 (`Earthdata OPeNDAP`) | OPeNDAP subsets + our own area mean |
| `blackmarble` | `providers/blackmarble.py` | VIIRS Black Marble VNP46A3 night lights (`LAADS`) | LAADS OPeNDAP subsets per 10° tile (strided for big areas), tiles combined |
| `noaa_gml` | `providers/noaa_gml.py` | CO₂/CH₄ records (`NOAA GML`) | NOAA monthly text files |
| `appeears` | `providers/appeears.py` | nothing in the catalog (`AppEEARS`) | AppEEARS area task → statistics CSV |
| `live` | `providers/live.py` | everything, by each variable's `access` | delegates to the providers above |

**Prefetch** (`.venv/bin/python -m app.prefetch`, see its docstring): fills the caches for every example
case's variable and "compare with" variable over the example's area, for the whole availability. `--noaa`
(no login needed), `--earthdata` (GES DISC, LP DAAC and LAADS), `--list` (print the plan), `--save-seed`
(copy the cache into `app/data/seed/cache/` to commit; the app installs it at startup).

To add a source:

1. Implement `fetch(variable, bbox, start, end) -> pd.Series` (protocol in `app/providers/base.py`):
   return a **monthly, area-mean** series (month-start `DatetimeIndex`, floats, NaN for missing months)
   in the catalog's units. Daily data → `processing.timeseries.to_monthly`; gridded data →
   `processing.timeseries.area_mean`; native units → `variable.to_catalog_units(values)`. `bbox` is
   `None` for `series` variables. Raise `ProviderError("message for students")` on failure.
2. Decorate a factory with `@register_provider("name")`, import its module in `app/providers/__init__.py`,
   and map its catalog `access` value to it in `ACCESS_TO_PROVIDER` (`providers/live.py`). Test it alone with
   `TD_DATA_PROVIDER=<name>`.

The `product` field of each catalog variable holds the NASA product id and variable name
(`"<ShortName>.<version>:<Variable>"`, e.g. `M2TMNXAER.5.12.4:DUSMASS`).

## Field guide chatbot

`app/chat/fieldguide.py` (`TD_CHAT_BACKEND=fieldguide`) answers with an LLM: OpenAI GPT by default (`OPENAI_API_KEY`,
prepaid credit), or Gemini with `TD_CHAT_PROVIDER=gemini` (free key at https://aistudio.google.com/apikey). Put the key in `backend/.env`
(template: `.env.example`). Without a key the app still starts and the chat answers with the stub.

- **Knowledge** is built from the catalog at startup: every variable's definition and "why it matters", and every
  example case with its checked takeaway. A new variable or case in the YAML is known to the bot with no prompt edit.
- **Context** per message: the student's variable, area (`bbox`) and the latest result's plain-English summary,
  exactly what `ChatDrawer` sends. The prompt tells the model to use only those numbers and never invent statistics.
- The last 21 messages are sent. LLM failures answer HTTP 503 with a readable `detail`, shown in the chat drawer.
- Tests (`tests/test_chat_fieldguide.py`) inject a fake LLM, so they run offline; the test settings force the stub.

To plug in a different bot: implement `ChatBackend` (`app/chat/base.py`), register it with
`@register_chat_backend("name")`, import the module in `app/chat/__init__.py`, start with `TD_CHAT_BACKEND=name`.

## Uploading your own data

`POST /api/datasets` with a CSV file (header `date,value`, ISO dates). Daily or irregular data is averaged
to months; yearly data is analyzed as annual. Then run an analysis with `variable_id: "upload:<id>"`
(the bbox may be omitted for uploads, as for `series` variables).
