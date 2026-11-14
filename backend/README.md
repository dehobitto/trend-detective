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
synthetic by default, NOAA tests use the trimmed files in `tests/fixtures/` and a mocked httpx).

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
| `TD_UPLOAD_DIR` | `backend/data/uploads` | Where uploaded CSV datasets are stored |
| `TD_MAX_UPLOAD_BYTES` | `5242880` | Upload size limit |
| `TD_MAX_JOBS` | `500` | In-memory job history size |

## Layout

```
app/
  main.py          create_app() factory: settings -> services -> routers, CORS, error format
  config.py        Settings (TD_ env prefix)
  prefetch.py      `python -m app.prefetch`: download real-data files into the cache
  api/             routers: health, catalog (variables/examples), analyses, datasets, chat; deps.Services
  schemas/         pydantic models mirroring docs/API.md
  catalog/         variables.yaml, examples.yaml, loader (validated at startup)
  providers/       base.py (DataProvider protocol + registry, Route), synthetic.py, upload.py,
                   noaa_gml.py (real CO₂/CH₄ records), real-data stubs nasa_giovanni.py (Giovanni / GES DISC),
                   appeears.py (MODIS LST), knmi.py (alternative CO₂/CH₄ mirror, unused),
                   live.py (`auto` and `live`: route a variable to a provider by its `access` field)
  processing/      timeseries.py, preprocess.py, trends.py, summary.py (pure functions, unit tested)
  jobs/            store.py (JobStore protocol + in-memory store), resolve.py (validation, bbox rules, date clamping), runner.py
  chat/            ChatBackend protocol + registry, StubChatBackend
tests/             pytest: trends, processing, catalog, synthetic provider (incl. the example stories), API,
                   NOAA GML parsing/cache/fallback (fixtures/ = trimmed NOAA files)
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

## Real data: NOAA GML greenhouse-gas records

`providers/noaa_gml.py` serves every catalog variable whose `product` is `NOAA-GML:<file>` from
`https://gml.noaa.gov/webdata/ccgg/trends/<gas>/<file>.txt` (`co2/co2_mm_mlo`, `co2/co2_mm_gl`,
`ch4/ch4_mm_gl`; public, no auth). It parses column 4 (the monthly mean, "average"; values ≤ -9 such as
`-9.99`/`-99.99` are missing), returns a complete month-start series, and caches the raw file in
`TD_CACHE_DIR/noaa_gml/` for `TD_NOAA_CACHE_TTL_DAYS`. If a refresh fails, the stale copy is used; with no
copy at all, `auto` falls back to synthetic data and the result says "Couldn't reach NOAA; showing demo
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
