# Trend Detective — backend

FastAPI service that turns *(region, Earth-science variable, dates)* into a time series plus trend
statistics (OLS + t-test + confidence intervals, Mann-Kendall, Sen's slope) and a plain-English verdict.
The API contract is [`../docs/API.md`](../docs/API.md); architecture is in [`../docs/SPEC.md`](../docs/SPEC.md).

Data sources (default `TD_DATA_PROVIDER=auto`): the three greenhouse-gas records (Mauna Loa CO₂, global
marine CO₂ and CH₄) are **real NOAA GML data** (`provider: "noaa_gml"`, `synthetic: false`, no "Demo data"
badge). Every other variable still comes from a deterministic **synthetic provider** that generates
realistic demo series (results carry `synthetic: true`) until its NASA provider is implemented.

## Catalog: the team's datasets

`app/catalog/variables.yaml` lists the variables the team uses (source of truth: the team's
"Датасети та змінні" list). `GET /api/variables` returns them; ids below.

| Dataset | Variables (catalog id → product variable) | Units shown | Coverage | Access |
|---|---|---|---|---|
| GLDAS_CLSM025_DA1_D v2.2 (daily, 0.25°, 2003-02 →) | `gldas_gws` → GWS_tavg, `gldas_tws` → TWS_tavg | mm | land | Giovanni |
| OMNO2d v004 (daily, 0.25°, 2004-10 →) | `omi_no2` → ColumnAmountNO2TropCloudScreened | 10¹⁵ molecules/cm² (from molecules/cm²) | global | Giovanni |
| MODIS MOD11C3 v061 (monthly, 2000-03 →) | `modis_lst_day` → LST_Day_CMG, `modis_lst_night` → LST_Night_CMG | °C (from K) | land | AppEEARS |
| MERRA-2 M2TMNXAER v5.12.4 (monthly, 1980 →) | `merra2_dust` DUSMASS, `merra2_bc` BCSMASS, `merra2_oc` OCSMASS, `merra2_so2` SO2SMASS, `merra2_so4` SO4SMASS | µg/m³ (from kg/m³) | global | Giovanni |
| | `merra2_aod` TOTEXTTAU, `merra2_sulfate_aod` SUEXTTAU | unitless | global | Giovanni |
| GPM_3IMERGM v07 (monthly, 0.1°, 2000-06 →) | `gpm_precipitation` → precipitation | mm/day (from mm/hr) | global | Giovanni |
| Mauna Loa CO₂ (NOAA/Scripps, 1958-03 → 2026-09) | `mauna_loa_co2` | ppm | series | NOAA GML (real) |
| Global marine CO₂ (NOAA, 1979-01 → 2026-07) | `noaa_co2_marine` | ppm | series | NOAA GML (real) |
| Global marine CH₄ (NOAA, 1983-07 → 2026-06) | `noaa_ch4_marine` | ppb | series | NOAA GML (real) |

The `available_end` of the three NOAA records is the latest month in NOAA's files when last checked
(2026-11); bump it in `variables.yaml` when the files gain months.

Water vapor and ozone are not in the catalog yet (the team has not picked datasets); a commented TODO
block at the end of `variables.yaml` shows where they go.

- **`coverage: "series"`** = one ready-made record (a station or a global mean). The request `bbox` may be
  omitted; if sent it is ignored (with a warning) and `result.bbox` is `null`. Mauna Loa has a `location`.
- **Daily products are served as monthly area means**: aggregation (days → calendar months, grid cells →
  bbox mean) happens inside the provider, so the pipeline always receives a monthly series.
- **Unit conversion** from the native product units is stored per variable in the internal `conversion`
  block (`value * scale + offset`, applied with `CatalogVariable.to_catalog_units`), for real providers.
- `examples.yaml` holds the one-click detective cases, each with an optional `related_variable_id`
  ("compare with", e.g. Punjab groundwater vs. rainfall) and a one-sentence `takeaway`.

The synthetic provider is tuned so each example tells its real-world story: groundwater falling ~15 mm/yr
in NW India (and in California's Central Valley, the North China Plain and the Middle East) while Punjab
rainfall has no significant trend; NO₂ falling over US/European cities and Beijing since ~2011, rising over
Delhi, with a spring-2020 lockdown dip; SO₂/sulfate rising until ~2010 then falling steeply over China and
rising over India; urban LST warming in Phoenix, Delhi, Cairo and Lagos; summer dust maxima over the
Sahara and Middle East; the Keeling curve (seasonal peak in May) and methane's 2000–2006 plateau.

## Run

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m app.prefetch   # optional: download the NOAA files into data/cache/ for offline demos
.venv/bin/uvicorn app.main:app --reload --port 8000
```

Interactive docs: http://localhost:8000/docs. Tests: `.venv/bin/python -m pytest` (no network: tests run
synthetic by default, NOAA tests use the trimmed files in `tests/fixtures/` and a mocked httpx, geocoding
tests an `httpx.MockTransport`).

## Environment variables

All settings live in `app/config.py` and can be overridden with `TD_`-prefixed variables (or a `.env` file).

| Variable | Default | Meaning |
|---|---|---|
| `TD_DATA_PROVIDER` | `auto` | `auto`: real data where a provider is implemented (NOAA GML records), synthetic elsewhere and as fallback; `synthetic`: demo data for everything; `live`: real providers only, routed by `access`, no fallback (stubs raise); or a single provider name (`noaa_gml`, stubs `giovanni`, `appeears`, `knmi`) |
| `TD_SYNTHETIC_DELAY` | `0.3` | Seconds of artificial delay per job stage for local providers, so progress is visible |
| `TD_CHAT_BACKEND` | `stub` | Registered chat backend |
| `TD_CORS_ORIGINS` | `["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173"]` | JSON list of allowed origins |
| `TD_CACHE_DIR` | `backend/data/cache` | Downloaded source files (gitignored); NOAA files go in `noaa_gml/` |
| `TD_NOAA_CACHE_TTL_DAYS` | `7` | A cached NOAA file older than this is downloaded again (stale copy used if that fails) |
| `TD_NOAA_GML_BASE_URL` | `https://gml.noaa.gov/webdata/ccgg/trends` | Where `<gas>/<file>.txt` are downloaded from |
| `TD_HTTP_TIMEOUT` | `30` | Seconds before a data download gives up |
| `TD_NOAA_SEED_DIR` | `backend/app/data/seed/noaa_gml` | Committed NOAA files used when nothing is cached and NOAA is unreachable (copied into the cache) |
| `TD_UPLOAD_DIR` | `backend/data/uploads` | Where uploaded CSV datasets are stored |
| `TD_MAX_UPLOAD_BYTES` | `5242880` | Upload size limit |
| `TD_STATIC_DIR` | unset | Built frontend (`frontend/dist`) served at `/` with index.html fallback; set by the Docker image (`docs/DEPLOY.md`) |
| `TD_MAX_JOBS` | `500` | In-memory job history size |
| `TD_GRID_PREWARM` | `true` | Compute every variable's map color range in a background thread at startup |
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
  prefetch.py      `python -m app.prefetch`: download real-data files into the cache
  api/             routers: health, catalog (variables/examples), analyses, datasets, chat, grid, geocode;
                   deps.Services
  schemas/         pydantic models mirroring docs/API.md (grid.py: GridFrame/Colormap, geocode.py: Place)
  catalog/         variables.yaml, examples.yaml, colormaps.yaml, loader (validated at startup)
  grid/            service.py (/api/grid frames, color ranges, caching), landmask.py (land fraction per cell)
  geocode.py       Photon -> Nominatim place search with TTL cache and Nominatim rate limit
  data/            landmask.npy (committed: 1600x800 land/sea bits from the frontend water texture)
                   seed/noaa_gml/ (committed NOAA CO₂/CH₄ files, offline fallback for the NOAA provider)
  tools/           gibs_layers.py (refresh GIBS map layers), build_landmask.py (rebuild data/landmask.npy)
  providers/       base.py (DataProvider protocol + registry, Route), synthetic.py, upload.py,
                   noaa_gml.py (real CO₂/CH₄ records), real-data stubs nasa_giovanni.py (Giovanni / GES DISC),
                   appeears.py (MODIS LST), knmi.py (alternative CO₂/CH₄ mirror, unused),
                   live.py (`auto` and `live`: route a variable to a provider by its `access` field)
  processing/      timeseries.py, preprocess.py, trends.py, summary.py (pure functions, unit tested)
  jobs/            store.py (JobStore protocol + in-memory store), resolve.py (validation, bbox rules, date clamping), runner.py
  chat/            ChatBackend protocol + registry, StubChatBackend
tests/             pytest: trends, processing, catalog, synthetic provider (incl. the example stories), API,
                   NOAA GML parsing/cache/fallback (fixtures/ = trimmed NOAA files), grid frames, geocoding
```

Analysis pipeline (`jobs/runner.py`): `resolve` (variable, provider via `route()`, clamped dates) → `provider.fetch`
(on `ProviderError`, the route's fallback provider plus its warning)
(monthly area mean) → aggregate (monthly/annual) → `preprocess` (gap fill, deseasonalize) → `trends.analyze`
→ `build_summary`. Job status goes `queued → fetching → processing → analyzing → done | error`.

Notes on the numbers:
- Time is measured in decimal years; `intercept` is the fitted value at the first date of the series.
- With `deseasonalize`, the trend is fitted to monthly anomalies (value minus that calendar month's mean),
  so `trend`/`ci_low`/`ci_high` in `series` are on the anomaly scale.
- `significant` requires both the OLS t-test and Mann-Kendall to have p < alpha.
- `direction` is the sign of the OLS slope, or `flat` when the total change is < 5% of the series' std-dev.
- `percent_change` is relative to the mean raw value; it is `null` for temperatures (°C has no true zero).

## Map: GIBS layers, grid frames, place search (API v2)

Every area variable has a public `map_layer` (`docs/API.md`, "v2 additions"); `series` variables have `null`.

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
| `modis_lst_day` | `MODIS_Terra_L3_Land_Surface_Temp_Monthly_Day` | monthly | 2000-03 → 2026-10 | MOD11C3 |
| `modis_lst_night` | `MODIS_Terra_L3_Land_Surface_Temp_Monthly_Night` | monthly | 2000-03 → 2026-10 | MOD11C3 |
| `merra2_bc`, `merra2_oc`, `merra2_so4`, `merra2_sulfate_aod` | – (`kind: grid`) | | | no GIBS layer for these MERRA-2 species |

All use `GoogleMapsCompatible_Level6` (max zoom 6), PNG, with GIBS's horizontal SVG legend as `legend_url`.
Refresh after GIBS changes: `.venv/bin/python -m app.tools.gibs_layers` (prints suggested `map_layer` blocks
and checks a tile per layer; `--search no2` lists matching layers; `--no-verify` skips tile downloads),
then paste into `variables.yaml`. Preferences per variable live in `CANDIDATES` in that script.

**Grid frames** (`GET /api/grid/{variable_id}?date=YYYY-MM-01[&west&south&east&north][&res]`): a
`GridFrame` for every area variable (also those with a GIBS layer), synthetic for now (`synthetic: true`).
Values come from the same model as the synthetic area series (`providers/synthetic.py: _signal`, used by both
`generate` and `grid_values`), so the heatmap shows the chart's hotspots, trends, breaks and seasonality; the
red noise is a smooth field of plane waves with AR(1) amplitudes that depends only on the variable, so panning
or zooming never changes a cell's value. Land variables (`coverage: land`) are `null` where less than half of
a cell is land (`data/landmask.npy`, a 0.225° mask from the frontend's water texture; lakes count as water).
Size: without `res`, the longer side gets 160 cells but never finer than 0.1°; each axis is capped at 200.
Default bbox: the whole globe. `min`/`max` are stable per variable: area-weighted 2nd–98th percentile of a
global 2° sample over 24 months spread across the record, widened to include each hotspot's median (so Beijing
NO₂ or Punjab groundwater stay readable), rounded to 2 significant digits. `colormap` (catalog
`colormap:` → `catalog/colormaps.yaml`, 9 stops spread over min..max): `inferno` for LST, `blue_green` for
precipitation, `yellow_orange_brown` for NO₂ and aerosols, diverging `brown_teal` for GLDAS water storage.
Frames are cached as JSON bytes (LRU, 512) and gzip-compressed; an uncached 200×200 frame takes ~50 ms.
`/api/grid/{id}/dates` lists the month starts from `available_start` to `available_end`. Errors: 404 for
unknown or `series` variables, 422 for a month outside availability or a partial/invalid bbox.

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
cached copy the committed seed in `app/data/seed/noaa_gml/` is used (`TD_NOAA_SEED_DIR`); with neither, `auto` falls back to synthetic data and the result says "Couldn't reach NOAA; showing demo
data." (plus the usual "Demo data" warning, `synthetic: true`). Under `live` the same failure is a job error.

Routing (`providers/live.py`): `auto` and `live` implement `route(variable) -> Route(provider, fallback,
fallback_warning)`; `jobs/resolve.py` uses it so the result reports the concrete provider (`noaa_gml`,
`synthetic`), and `jobs/runner.py` applies the fallback. `ACCESS_TO_PROVIDER` maps `access` values to
providers and `IMPLEMENTED` lists the providers `auto` trusts for real data.

## How to plug in real NASA data

Three stubs are registered, one per access path, each with a docstring listing its exact products,
native units and TODOs:

| Provider | File | Serves (`access`) | Route |
|---|---|---|---|
| `giovanni` | `providers/nasa_giovanni.py` | GLDAS, OMNO2d, MERRA-2 M2TMNXAER, GPM IMERG (`Giovanni`) | Giovanni area-averaged time series, or GES DISC OPeNDAP + our own area mean |
| `appeears` | `providers/appeears.py` | MODIS MOD11C3 LST day/night (`AppEEARS`) | AppEEARS area task → NetCDF/statistics CSV |
| `knmi` | `providers/knmi.py` | nothing today (`KNMI Climate Explorer`): the CO₂/CH₄ records now come from NOAA GML directly | KNMI `.dat` text series |
| `live` / `auto` | `providers/live.py` | everything, by each variable's `access` | delegates to the providers above and `noaa_gml` |

To fill one in:

1. Implement `fetch(variable, bbox, start, end) -> pd.Series` (protocol in `app/providers/base.py`):
   return a **monthly, area-mean** series (month-start `DatetimeIndex`, floats, NaN for missing months)
   in the catalog's units. Daily data → `processing.timeseries.to_monthly`; gridded data →
   `processing.timeseries.area_mean`; native units → `variable.to_catalog_units(values)`. `bbox` is
   `None` for `series` variables. Raise `ProviderError("message for students")` on failure.
2. Add its name to `IMPLEMENTED` in `providers/live.py` so the default `auto` mode uses it (with synthetic
   fallback), or test it alone with `TD_DATA_PROVIDER=live` (or the single provider's name). To add a new provider, decorate a
   factory with `@register_provider("name")` and import its module in `app/providers/__init__.py`.

The `product` field of each catalog variable holds the NASA product id and variable name
(`"<ShortName>.<version>:<Variable>"`, e.g. `M2TMNXAER.5.12.4:DUSMASS`).

## How to plug in the chatbot

1. Implement `ChatBackend` (`app/chat/base.py`): `async def reply(self, request: ChatRequest) -> ChatResponse`.
   The request has the whole conversation plus context (`bbox`, `variable_id`, `result_summary`).
   Return `stub=False`.
2. Register it: `@register_chat_backend("fieldguide") def _factory(settings): return MyBot(...)` and import
   the module in `app/chat/__init__.py`.
3. Start with `TD_CHAT_BACKEND=fieldguide`. Add any API keys as new fields in `Settings`.

## Uploading your own data

`POST /api/datasets` with a CSV file (header `date,value`, ISO dates). Daily or irregular data is averaged
to months; yearly data is analyzed as annual. Then run an analysis with `variable_id: "upload:<id>"`
(the bbox may be omitted for uploads, as for `series` variables).

## Change maps (API.md "v3 additions")

- `GET /api/grid/{id}?date=…&mode=anomaly` — value minus that calendar month's climatology (mean over the
  variable's whole availability, cached per grid). Range is symmetric `-R..R`, stable per variable
  (R = 98th percentile of |anomaly| on a 3° global sample); colormap `diverging`
  (#07668A falling … #F2F4F5 at 0 … #9A5200 rising). Units unchanged.
- `GET /api/grid/{id}/trend?start&end[&west,south,east,north][&res][&alpha=0.05]` — `TrendGrid`: per-cell OLS
  slope **per decade** of the deseasonalized monthly series (each calendar month's mean over the period
  removed; closed form, vectorized over cells) plus `significant` per cell. Units `"<units> per decade"`,
  `date = end`; dates are clamped to availability, < 3 years → 422. Global default resolution 2° (180×90,
  ~0.2–0.6 s cold, cached afterwards); regional requests use the normal grid size (≤ 200×200).
- **Significance uses Mann-Kendall on annual means** of the deseasonalized series (years with < 6 months
  dropped; normal approximation, var(S) = n(n−1)(2n+5)/18). This keeps the pairwise sign sum cheap
  (~300 pairs per cell instead of ~45 000) and removes most month-to-month autocorrelation. The area
  analysis (`/api/analyses`) still runs MK on the monthly series, so a borderline cell can disagree with it.
- Trend colour range: 98th percentile of |slope| on a 3° global sample, widened toward 75 % of the strongest
  catalog hotspot but at most 5× the background (hotspot cores such as Punjab groundwater may saturate).
  Ranges are prewarmed in the background at startup with the value ranges.
- Code: `app/grid/change.py` (vectorized cube, climatology, slope, MK), `app/grid/service.py`.
