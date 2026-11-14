# Trend Detective: frontend

Vite + React 18 + TypeScript. A realistic 3D globe (three.js / @react-three/fiber) hands off to a 2D
MapLibre map of NASA GIBS imagery, where students draw an area, pick a NASA variable and get a trend
verdict with significance tests. Product spec: `../docs/SPEC.md`. API contract: `../docs/API.md`.

## Run

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173, proxies /api -> http://localhost:8000
npm run build        # type-check (tsc -b) + production build into dist/
```

Start the backend first for live data (`cd ../backend && .venv/bin/uvicorn app.main:app --port 8000`).
If it is not running, the app falls back to the built-in mock automatically (see below).

## Mock mode

`src/api/client.ts` decides once at startup:

- `VITE_USE_MOCKS=true` -> always use the in-browser mock (`src/api/mock.ts`).
- otherwise it calls `GET /api/health`; if that fails or takes longer than `healthTimeoutMs`, it uses the mock.

```bash
VITE_USE_MOCKS=true npm run dev     # or put it in .env.local (see .env.example)
```

The mock implements the whole API contract with deterministic synthetic data (`mock.ts`,
`mockCatalog.ts`, `mockStats.ts`) and is lazy-loaded, so it never touches the live path. An
"Offline demo" badge shows on the globe screen when it is active; results always show "Demo data"
when `result.synthetic` is true.

## Where the tunables live (`src/config/`)

| File | What |
|---|---|
| `theme.css` | Design tokens (colours, fonts, radii, panel width, fade duration). Two accents only: `--rise`, `--fall`. |
| `colors.ts` | JS mirror of the colour tokens (charts, WebGL). |
| `app.ts` | API base, force-mocks flag, health timeout, job polling interval/timeout, default dates and alpha. |
| `globe.ts` | Texture paths, camera FOV/distances, wheel zoom threshold that opens the map, fly-in duration, auto-rotate speed and resume delay, bump/shininess, atmosphere size/strength, vertical lift. |
| `map.ts` | GIBS tile URLs (basemap, coastlines, labels), arrival zoom, zoom-out level that returns to the globe, fit padding, minimum box size. |
| `motion.ts` | Crossfade duration and `prefers-reduced-motion` helpers (reduced motion stops rotation and cuts transitions). |

## Layout

```
src/
  config/      tunables (above)
  api/         types.ts (mirrors API.md), client.ts (HTTP + mock switch), mock*.ts
  state/       store.ts (zustand: view, transition, bbox, variable, dates, job, example, chat)
  lib/         geo.ts (lat/lon <-> sphere maths, bbox helpers), format.ts
  components/  Button, Badge/Chip, Toggle, Segmented, Wordmark, icons
  features/
    globe/       GlobeView, Earth, Atmosphere (fresnel shaders), Stars, CameraRig (orbit, fly-to, zoom hand-off)
    map/         MapView, layers, useBoxSelect (draw/move rectangle), useStationMarker, overlayProtocol, MapToolbar
    investigate/ InvestigationPanel, Step, AreaStep, VariablePicker, DateRange, AnalysisOptions, JobProgress, useRunAnalysis
    results/     ResultsView, VerdictCard, TrendChart, StatsTable, CompareView, downloadCsv
    examples/    ExampleCases (case-file prompt on the globe)
    datasets/    UploadDataset (CSV date,value -> "Your data")
    chat/        chatAdapter.ts, ChatLauncher, ChatDrawer
```

The globe stays mounted (its render loop pauses while the map is shown); the map is lazy-mounted on the
first hand-off and then kept, so transitions are a pure opacity crossfade.

## Swapping the field-guide chat

Every chat call goes through **`src/features/chat/chatAdapter.ts`**:

```ts
export interface ChatAdapter { send(req: ChatRequest): Promise<ChatResponse> }
```

The default (`backendChatAdapter`) calls `POST /api/chat`. To plug in the real assistant, either replace
the implementation in that file, or register yours at startup in `src/main.tsx`:

```ts
import { setChatAdapter } from './features/chat/chatAdapter';
setChatAdapter({ send: async (req) => ({ stub: false, message: { role: 'assistant', content: await myBot(req) } }) });
```

`req.context` carries the current bbox, variable id and result summary. No UI code needs to change.

## Notes

- Globe click -> lat/lon uses the raycast hit's texture UV (`uvToLatLon`), and fly-to uses
  `latLonToVector3`; both were verified against `THREE.SphereGeometry` vertices.
- GIBS serves empty overlay tiles as opaque black PNGs (and occasionally 500s). `overlayProtocol.ts`
  replaces those with transparent tiles so labels/coastlines don't black out the basemap.
- Variables are never hardcoded in the UI: the picker renders whatever `GET /api/variables` returns,
  grouped by sphere. `coverage: "series"` variables (station or global records) skip the area step.
- Example cases with `related_variable_id` offer "Compare with ..." in the results, which runs a second
  analysis for the same area and period.
