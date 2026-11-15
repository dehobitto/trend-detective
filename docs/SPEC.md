# Trend Detective — product & architecture spec

NASA Space Apps 2026 challenge: **"Be An Earth System Trend Detective!"** (see `../NASA Space Apps Challenge.html`).
Users pick a region + an Earth-science variable (MODIS, OMI, AIRS, GPM, MERRA-2, GLDAS…), see its time
series, and get the rate of change + whether the trend is statistically significant (OLS t-test with CI,
Mann-Kendall + Sen's slope). Audience: high-school / college students — clear, not childish.

All data is real: GES DISC products (GLDAS, GPM, OMI, MERRA-2) and MODIS monthly grids via OPeNDAP, VIIRS
night lights via LAADS OPeNDAP, CO₂/CH₄ from NOAA GML, plus user uploads. There is no demo or fallback data; when a source fails, the analysis says so in plain language.
Each source is one provider behind one interface. Modularity + UI/UX are the priority.

## Repo layout

```
backend/    FastAPI (Python 3.12), port 8000
frontend/   Vite + React + TypeScript, port 5173, proxies /api -> :8000
docs/       SPEC.md (this), API.md (contract — both sides MUST follow it)
```

## UX flow (one sequence, so numbered steps are legitimate)

1. **Globe (home).** Full-viewport, realistic 3D Earth (NASA Blue Marble texture, bump/specular, soft
   atmosphere rim glow, star field). Rotates slowly. Drag to rotate, wheel to zoom.
   - Wheel-zooming in past a threshold OR clicking a point on the globe → camera flies toward that lat/lon,
     then crossfades into the 2D map centered there.
   - Small floating "case" prompt bottom-center: "Pick a place to investigate" + example cases.
2. **2D map.** MapLibre GL, basemap = NASA GIBS Blue Marble raster tiles (no API key) + GIBS reference
   labels/coastlines overlay. User draws a **rectangle** (toggle "Draw area" tool, or Shift+drag) → bbox;
   a rectangle under 0.25° is enlarged to 0.25° (about one data cell) with a short note on the map. Or the user
   picks a **named area** in place search (country, state, city): its OSM boundary is approximated by grid
   squares (`/api/regions/shape`) and the analysis averages only inside them.
   Zooming out below min zoom, or "Back to globe" button → returns to globe.
3. **Investigation panel** (right side drawer, appears once a bbox exists): bbox readout (editable lat/lon),
   variable picker grouped by sphere (Atmosphere / Land / Ocean / Water cycle) with plain-language
   definitions, date range, deseasonalize toggle, aggregation (monthly/annual) → "Run analysis".
4. **Results**: time-series chart (raw values + trend line + 95% CI band, optional deseasonalized series),
   and a plain-English verdict card: "Rising by 0.21 °C per decade. This trend is significant (p = 0.003)."
   Shows OLS slope ± CI, t-test p, Mann-Kendall tau/p, Sen's slope, n, period. Short "What does this mean?"
   explainers. Download CSV of the series.
5. **Example cases** (the one-click presets the brief asks for): set bbox + variable + dates in one click
   (Punjab groundwater vs. rainfall, Delhi NO₂, China sulfate haze, Phoenix nights, Mauna Loa CO₂, global
   methane, Rondônia forest NDVI, Sahel greening, Delhi night lights). Defined in backend catalog, served via
   API; every takeaway was checked against the real data for the case's default dates.
6. **Bring your own data**: upload a CSV (`date,value`) → appears as a dataset you can analyze/plot with the
   same pipeline.
7. **Field guide chat (stub)**: floating button bottom-right opens a chat drawer. Backend `/api/chat`
   returns a canned reply. Another teammate will plug in the real bot — keep it behind a single adapter.

## Backend architecture (FastAPI)

```
backend/
  pyproject.toml / requirements.txt  (fastapi, uvicorn, pydantic-settings, numpy, scipy, pandas, pyyaml, python-multipart, httpx)
  app/
    main.py            app factory, CORS, router mounting
    config.py          Settings (env prefix TD_), e.g. TD_DATA_PROVIDER=live, TD_EARTHDATA_USERNAME/PASSWORD
    prefetch.py        `python -m app.prefetch`: fill the data caches for every example case (`--save-seed`)
    seed.py            copies the committed real-data seed (`app/data/seed/cache/`) into the cache at startup
    regions.py         named areas: OSM boundary -> grid squares + simplified outline
    api/               routers: health, catalog, analyses, datasets, chat, geocode
    schemas/           pydantic models (mirror docs/API.md exactly)
    catalog/           variables.yaml, examples.yaml, loader
    providers/         base.py (DataProvider protocol + registry, fetch_progress, region masks),
                       live.py (routes by catalog `access`), earthdata.py (GES DISC + LP DAAC MODIS OPeNDAP),
                       blackmarble.py (VIIRS night lights, LAADS), noaa_gml.py (CO₂/CH₄), upload.py (user CSVs),
                       appeears.py (MODIS 1 km via AppEEARS; kept, not used by the catalog: its queue is too slow)
    processing/        timeseries.py (area mean, resample), preprocess.py (gap fill, deseasonalize/anomalies),
                       trends.py (OLS+t-test+CI, Mann-Kendall, Sen's slope) — pure numpy/scipy, unit tested
    jobs/              in-memory job store + runner (BackgroundTasks); interface allows swapping to a queue later
    chat/              ChatBackend protocol + StubChatBackend
  tests/               pytest for processing/trends, providers (stubbed HTTP) + API tests (test-only `fake` provider)
```

Pipeline for an analysis job: `provider.fetch(variable, bbox, start, end) -> pd.Series (monthly, area-mean)`
→ `preprocess` → `trends.analyze` → result. Each stage is a plain function; job runner just chains them and
updates status/progress (`queued → fetching → processing → analyzing → done | error`).

Providers fetch only what the bbox needs (OPeNDAP subsets of the bbox's grid cells) and cache the monthly area
means on disk (`TD_CACHE_DIR`), so a repeated area is instant. While downloading they report `(done, total)`
through `providers.base.fetch_progress`; the job shows it as progress. The example cases' series are committed
as a seed and installed into the cache at startup. A `ProviderError` ends the job with its student-readable
message (no fallback). See `backend/README.md`.

## Frontend architecture

```
frontend/src/
  config/        theme tokens (css vars), globe.ts, map.ts (GIBS urls, zoom thresholds), app.ts (API base, flags)
  api/           client.ts (typed fetch), types.ts (mirror API.md)
  state/         zustand store: view ('globe'|'map'), focus lat/lon, bbox, selected variable, job, results
  features/
    globe/       R3F Earth: Earth.tsx, Atmosphere.tsx, Stars.tsx, GlobeView.tsx (zoom→map transition)
    map/         MapView.tsx, useBoxSelect.ts (rectangle draw), layers
    investigate/ InvestigationPanel, VariablePicker, DateRange, RunButton
    results/     TrendChart (Recharts), VerdictCard, StatsTable, downloadCsv
    examples/    ExampleCases
    datasets/    UploadDataset
    chat/        ChatLauncher, ChatDrawer, chatAdapter.ts (single place to swap implementation)
  components/    small shared UI (Button, Drawer, Toggle, Tooltip, Badge)
  App.tsx
```

## Design direction (v2, light)

See frontend/README.md for tokens. Summary: cool survey-grey page `#E6EAEE`, panels `#F8FAFB`, ink `#18212B`,
rules `#D3D9DF`; data identity = rising ochre `#9A5200` / falling deep blue `#07668A` (AA on panels). Single
family Archivo (wide widths for wordmark + headline numbers, tabular figures). Realistic Earth (8k Blue Marble,
clouds, glint, night lights, thin limb) on a transparent canvas is the one bold element; everything else quiet,
opaque panels, radius by role (3/4/6px), one shadow only for panels over imagery, rules that carry meaning.
No pills, glass blur, italic subtitles, all-caps labels, middle-dot meta, gradient washes.
