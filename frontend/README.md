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

Start the backend first (`cd ../backend && .venv/bin/uvicorn app.main:app --port 8000`). There is no
offline / mock fallback: every number on screen comes from the backend. At startup `src/App.tsx` calls
`GET /api/health` (timeout `healthTimeoutMs`); if it does not answer, the app shows a
"Can't reach the server" card with a Reload button instead of any data.

## Where the tunables live (`src/config/`)

| File | What |
|---|---|
| `theme.css` | Design tokens for the light "survey plate" theme (colours, Archivo + width axis, radii by role, panel width, fade duration). Two accents only: `--rise` (ochre), `--fall` (fjord blue). |
| `colors.ts` | JS mirror of the colour tokens (charts, WebGL). |
| `app.ts` | API base, health timeout, job polling interval/timeout, default dates and alpha. |
| `globe.ts` | Texture paths, camera FOV/distances, wheel zoom threshold that opens the map, fly-in duration, auto-rotate speed and resume delay, relief, exposure, sun angle, cloud drift, limb size/strength, vertical lift, side-dock shift. |
| `map.ts` | GIBS tile URLs (basemap, coastlines, labels), arrival zoom, zoom-out level that returns to the globe, fit padding, minimum box size. |
| `motion.ts` | Crossfade duration and `prefers-reduced-motion` helpers (reduced motion stops rotation and cuts transitions). |

## Layout

```
src/
  config/      tunables (above)
  api/         types.ts (mirrors API.md), client.ts (HTTP client + health check)
  state/       store.ts (zustand: view, transition, bbox, variable, dates, job, example, chat)
  lib/         geo.ts (lat/lon <-> sphere maths, bbox helpers), format.ts
  components/  Button, Badge/Chip, Toggle, Segmented, Wordmark, icons
  features/
    globe/       GlobeView, Earth (day/night/cloud shaders), Atmosphere (limb), sun.ts (shared uniforms), CameraRig (orbit, fly-to, zoom hand-off, view-fixed sun)
    map/         MapView, layers, useBoxSelect (draw/move rectangle), useStationMarker, overlayProtocol, MapToolbar
    investigate/ InvestigationPanel, Step, AreaStep, VariablePicker, DateRange, AnalysisOptions, JobProgress, useRunAnalysis
    results/     ResultsView, VerdictCard, TrendChart, StatsTable, CompareView, downloadCsv
    examples/    ExampleCases (case-file prompt on the globe)
    datasets/    UploadDataset (CSV date,value -> "Your data")
    chat/        chatAdapter.ts, ChatLauncher, ChatDrawer
```

The globe stays mounted (its render loop pauses while the map is shown); the map is lazy-mounted on the
first hand-off and then kept, so transitions are a pure opacity crossfade.

## Variable layer: GIBS imagery, globe overlay, gestures

- **Map layer** (layer dock): the variable's NASA GIBS imagery (`Variable.map_layer`, time-enabled WMTS)
  with a timeline (play/pause, step, scrubber, speed). A variable with `map_layer: null` has no imagery:
  the dock shows a one-line note and the variable can still be analysed by drawing a box.
- **Globe overlay** (`features/globe/GlobeOverlay.tsx`): the same imagery draped on a sphere just
  above the ground (clouds fade out while it shows): one GIBS WMS EPSG:4326 image per date. Frames
  cross-fade and the next one is preloaded; land-only variables are cut along the real coastline with
  the water mask. `useFrameSync` runs in `App`, so the globe and the map share frames; the dock
  shows on the globe too (right of the case index; at the top below 1080 px).
- **Gestures** (`features/globe/wheelIntent.ts`, thresholds in `config/globe.ts` → `gestures`):
  two-finger trackpad swipe turns the globe (with inertia), trackpad pinch (ctrl+wheel) zooms and hands
  off to the map, a mouse wheel zooms as before. On the map a trackpad swipe pans
  (`map/useTrackpadPan.ts`); pinch and mouse wheel zoom. Touch: one finger turns, two fingers zoom.

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
