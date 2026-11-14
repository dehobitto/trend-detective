# Trend Detective — backend

FastAPI service that turns *(region, Earth-science variable, dates)* into a time series plus trend
statistics (OLS + t-test + confidence intervals, Mann-Kendall, Sen's slope) and a plain-English verdict.
The API contract is [`../docs/API.md`](../docs/API.md); architecture is in [`../docs/SPEC.md`](../docs/SPEC.md).

Real NASA data is not wired yet: by default a deterministic **synthetic provider** generates realistic
demo series (results carry `synthetic: true`).

## Run

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --reload --port 8000
```

Interactive docs: http://localhost:8000/docs. Tests: `.venv/bin/python -m pytest`.

## Environment variables

All settings live in `app/config.py` and can be overridden with `TD_`-prefixed variables (or a `.env` file).

| Variable | Default | Meaning |
|---|---|---|
| `TD_DATA_PROVIDER` | `synthetic` | Registered data provider for catalog variables (`synthetic`, `giovanni` stub) |
| `TD_SYNTHETIC_DELAY` | `0.3` | Seconds of artificial delay per job stage for local providers, so progress is visible |
| `TD_CHAT_BACKEND` | `stub` | Registered chat backend |
| `TD_CORS_ORIGINS` | `["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173"]` | JSON list of allowed origins |
| `TD_UPLOAD_DIR` | `backend/data/uploads` | Where uploaded CSV datasets are stored |
| `TD_MAX_UPLOAD_BYTES` | `5242880` | Upload size limit |
| `TD_MAX_JOBS` | `500` | In-memory job history size |

## Layout

```
app/
  main.py          create_app() factory: settings -> services -> routers, CORS, error format
  config.py        Settings (TD_ env prefix)
  api/             routers: health, catalog (variables/examples), analyses, datasets, chat; deps.Services
  schemas/         pydantic models mirroring docs/API.md
  catalog/         variables.yaml, examples.yaml, loader (validated at startup)
  providers/       base.py (DataProvider protocol + registry), synthetic.py, nasa_giovanni.py (stub), upload.py
  processing/      timeseries.py, preprocess.py, trends.py, summary.py (pure functions, unit tested)
  jobs/            store.py (JobStore protocol + in-memory store), resolve.py (validation/date clamping), runner.py
  chat/            ChatBackend protocol + registry, StubChatBackend
tests/             pytest: trends, processing, synthetic provider, API smoke tests
```

Analysis pipeline (`jobs/runner.py`): `resolve` (variable, provider, clamped dates) → `provider.fetch`
(monthly area mean) → aggregate (monthly/annual) → `preprocess` (gap fill, deseasonalize) → `trends.analyze`
→ `build_summary`. Job status goes `queued → fetching → processing → analyzing → done | error`.

Notes on the numbers:
- Time is measured in decimal years; `intercept` is the fitted value at the first date of the series.
- With `deseasonalize`, the trend is fitted to monthly anomalies (value minus that calendar month's mean),
  so `trend`/`ci_low`/`ci_high` in `series` are on the anomaly scale.
- `significant` requires both the OLS t-test and Mann-Kendall to have p < alpha.
- `direction` is the sign of the OLS slope, or `flat` when the total change is < 5% of the series' std-dev.
- `percent_change` is relative to the mean raw value; it is `null` for temperatures (°C has no true zero).

## How to plug in real NASA data

1. Implement the `DataProvider` protocol (`app/providers/base.py`): attributes `name`, `synthetic`,
   `local`, and `fetch(variable, bbox, start, end) -> pd.Series` returning a **monthly, area-mean** series
   (month-start `DatetimeIndex`, floats, NaN for missing months) in the catalog's units. Use
   `processing.timeseries.area_mean` / `to_monthly` if you download gridded or daily data. Raise
   `ProviderError("message for students")` on failure.
2. Register a factory: `@register_provider("giovanni") def _factory(settings): return MyProvider(settings)`,
   and make sure the module is imported in `app/providers/__init__.py`.
3. Start with `TD_DATA_PROVIDER=giovanni`.

`app/providers/nasa_giovanni.py` is a ready skeleton with TODOs describing the Giovanni area-averaged
time-series route and the GES DISC OPeNDAP route (Earthdata Login token, unit conversions, caching).
The `product` field of each catalog variable (`variables.yaml`) holds the NASA product id and variable name.

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
(the bbox may be omitted for uploads).
