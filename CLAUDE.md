# Trend Detective — Project Guide

NASA Space Apps Challenge 2026 project. Interactive web app that lets users pick any place on Earth, choose a climate/environmental variable, and see whether there is a statistically significant trend.

## Quick start

```bash
./start.sh          # backend :8000 + frontend :5173
./start.sh --test   # run backend tests + frontend build
./start.sh --prefetch  # download NASA data for example cases
```

Backend needs `backend/.env` with `TD_EARTHDATA_USERNAME` / `TD_EARTHDATA_PASSWORD` for new areas. Example cases work from bundled seed data.

## Architecture

```
backend/           FastAPI + Python (venv in backend/.venv)
frontend/          React + TypeScript + Vite
```

### Backend structure

```
app/
├── api/                  API endpoints (FastAPI routers)
│   ├── analyses.py       POST /analyses (start job), GET /analyses/{id}
│   ├── catalog.py        GET /catalog (variables + examples)
│   ├── chat.py           Field guide chat (LLM)
│   ├── datasets.py       User CSV upload
│   ├── geocode.py        Place name → bbox
│   ├── regions.py        Named region boundaries (OSM)
│   └── health.py
├── catalog/
│   ├── variables.yaml    All climate variables (id, units, dataset, provider, etc.)
│   ├── examples.yaml     14 example cases (Delhi lights, Spain groundwater, etc.)
│   └── loader.py         Parses YAML into CatalogVariable / ExampleCase models
├── providers/            Data fetchers — all return monthly pd.Series
│   ├── appeears.py       NASA AppEEARS (MODIS NDVI, GLDAS, GPM, OMI, MERRA2)
│   ├── earthdata.py      Direct Earthdata file download (MODIS LST)
│   ├── blackmarble.py    VIIRS Black Marble night lights (VNP46A3)
│   ├── noaa_gml.py       NOAA GML (CO2, CH4, N2O — global series)
│   ├── upload.py         User-uploaded CSV
│   └── live.py           Orchestrator: picks the right provider for a variable
├── processing/           Core analysis pipeline
│   ├── timeseries.py     area_mean, to_monthly, to_annual, decimal_years
│   ├── preprocess.py     fill_gaps, deseasonalize, seasonal_cycle → Preprocessed
│   ├── trends.py         OLS, Mann-Kendall, Sen slope + CI, analyze() → TrendAnalysis
│   ├── trend_significance.py  Stage 3: MK TFPW test, sensitivity analysis, verdict + confidence
│   ├── assessment.py     Converts Report → TrendAssessment (English names for API)
│   └── summary.py        Plain-English verdict ("Rising by 0.42 °C per decade…")
├── jobs/
│   ├── runner.py         AnalysisRunner: fetch → preprocess → analyze → assess → result
│   ├── resolve.py        Resolves AnalysisRequest into a Plan (provider, bbox, variable)
│   └── store.py          In-memory job store (JobStore)
├── schemas/
│   └── analysis.py       Pydantic models: AnalysisRequest, AnalysisResult, TrendStats, etc.
├── chat/                 Field guide (LLM-powered explainer)
├── config.py             Settings from env vars
├── main.py               FastAPI app factory
└── seed.py               Bundled data for example cases (offline fallback)
```

### Frontend structure

```
src/
├── api/                  API client + TypeScript types (types.ts mirrors backend schemas)
├── features/
│   ├── globe/            3D globe (deck.gl)
│   ├── map/              2D map (Mapbox)
│   ├── search/           Place search + variable picker
│   ├── investigate/      Analysis options panel (time range, aggregation, deseasonalize)
│   ├── results/          Results display:
│   │   ├── VerdictCard.tsx      Main verdict ("Rising by…")
│   │   ├── TrendChart.tsx       Time series chart + trend line + CI band (Recharts)
│   │   ├── AssessmentView.tsx   "Trend significance" panel (MK TFPW result)
│   │   ├── StatsTable.tsx       Detailed stats (slope, MK tau, R², etc.)
│   │   ├── CompareView.tsx      Related variable comparison
│   │   └── AiInsight.tsx        LLM-generated explanation
│   ├── examples/         Example case cards
│   ├── chat/             Chat panel (field guide)
│   ├── datasets/         CSV upload UI
│   └── layers/           Map layer controls
├── state/store.ts        Zustand store (global state)
├── components/           Shared UI components (Button, Segmented, etc.)
├── lib/format.ts         Number/date formatting helpers
└── config/colors.ts      Theme colors
```

## Data flow

1. **User** picks place + variable + date range + aggregation (monthly/annual)
2. **Frontend** → `POST /api/analyses` with `AnalysisRequest`
3. **Runner** resolves provider, fetches data (always monthly), optionally resamples to annual
4. **Preprocess**: fill short gaps, optionally deseasonalize (monthly only)
5. **Trend analysis** (`trends.analyze()`): Sen slope + CI, Mann-Kendall test
6. **Significance** (`trend_significance.assess_trend()`): MK TFPW, sensitivity windows, verdict
7. **Result** → `AnalysisResult` with series, stats, assessment, summary, warnings

## Statistical approach (after recent simplification)

**Single test**: Mann-Kendall TFPW (Trend-Free Pre-Whitening, Yue-Pilon 2002).
- Handles autocorrelation via pre-whitening; falls back to plain MK when autocorrelation is not significant.
- Nonparametric: no normality assumption, robust to outliers.

**Slope & CI**: Sen's slope (median of all pairwise slopes) with nonparametric CI based on MK variance. The CI band on the chart pivots at the temporal midpoint.

**Sensitivity analysis**: runs MK TFPW on 7 trimmed windows + outlier-removed variant. Reports share of variants with same sign and significance.

**Verdict logic**:
- MK TFPW significant → `significant_up` / `significant_down`
- Not significant → `not_significant`
- Downgraded to `ambiguous` if: sensitivity unstable (same_sign < 80% or significant < 50%), or structural break with sign change

**Confidence** (high/medium/low): penalty system based on sample size, residual seasonality, long memory (DFA), structural breaks, missing data, sensitivity.

## Key files to know

| What | File |
|------|------|
| Variable catalog | `backend/app/catalog/variables.yaml` |
| Example cases | `backend/app/catalog/examples.yaml` |
| Analysis job orchestration | `backend/app/jobs/runner.py` |
| Trend statistics (Sen, MK, CI) | `backend/app/processing/trends.py` |
| Significance testing (MK TFPW) | `backend/app/processing/trend_significance.py` |
| API schemas | `backend/app/schemas/analysis.py` |
| Frontend types (mirror) | `frontend/src/api/types.ts` |
| Chart | `frontend/src/features/results/TrendChart.tsx` |
| Verdict + stats display | `frontend/src/features/results/` |

## Running tests

```bash
cd backend && source .venv/bin/activate
python -m pytest tests/ -v          # 114 tests
```

```bash
cd frontend && npx tsc --noEmit     # type check
cd frontend && npm run build        # production build
```

## Env vars (backend/.env)

```
TD_EARTHDATA_USERNAME=...    # NASA Earthdata login
TD_EARTHDATA_PASSWORD=...
TD_OPENAI_API_KEY=...        # optional: field guide chat (GPT)
```
