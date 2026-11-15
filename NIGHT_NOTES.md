# Night notes (2026-11-15, 04:07–04:25)

## State
- Backend: `pytest` 101 passed. Frontend: `npm run build` passes.
- Browser QA (scratchpad `qa.mjs`, headless Chrome) passes all 8 flows on desktop 1440×900 and phone 390×844:
  globe click/wheel → map, city search → run, all 7 example cases, "Help me choose" guide, layer timeline
  (play/scrub/hide, GRACE gap month), CSV upload → analysis, chat stub, panel sheet.

## Done tonight
- Map is wrapped in an ErrorBoundary (`src/components/ErrorBoundary.tsx`): a crash (seen only during dev
  hot-reload) shows "The map stopped working / Reload map" instead of a white screen.
- Box edge grab zone on touch is 22 px (mouse stays 10 px), so the area can be moved with a finger.

## Known issues
- Pinch globe → map not tested on a real phone.
- Globe gives no "no image for this month" note for GIBS gap months (map does).
- If the backend is down when the page loads, the app shows a "Can't reach the server" card until reload:
  start the backend first.
- No demo data any more: every variable comes from its real source (GES DISC OPeNDAP, AppEEARS, NOAA GML).
  The NASA fetches are untested end-to-end until an Earthdata login is provided (only unit tests with stubbed
  HTTP so far). First things to confirm on the first real `python -m app.prefetch`: the AppEEARS statistics
  CSV format (columns/scaling in `providers/appeears.py`) and the OMNO2d v004 layout (group path, dimension order).
- Fresh deploys start with an empty cache: first request per area takes tens of seconds (GES DISC) to minutes
  (AppEEARS). See `docs/DEPLOY.md`.
- Not ported from the team repo yet: burned area (MCD64A1; needs every pixel to compute burned share).
- VIIRS night lights (`blackmarble` provider, VNP46A3 monthly via LAADS OPeNDAP) are untested against the
  real server too: confirm the LAADS DMR layout and that the Earthdata session is accepted by LAADS.
- `requirements.txt` unpinned; Docker image never built locally (first build will be in CI).
- Bundle chunks > 1 MB (three.js, maplibre); fine for a demo.

## Next steps (need you)
1. GitHub repo + Render (or Fly) account → follow `docs/DEPLOY.md` (CI, pre-push hook, auto-deploy on checks pass).
   Set `TD_EARTHDATA_USERNAME` / `TD_EARTHDATA_PASSWORD` as host secrets.
2. Earthdata login in `backend/.env` (template `backend/.env.example`; never in chat/git) → run
   `.venv/bin/python -m app.prefetch` (or `--earthdata`, `--appeears`, `--list`) and check every example case
   with real data; fix the AppEEARS CSV parsing / OMNO2d paths if they differ.
3. Teammate's chatbot: swap `frontend/src/features/chat/chatAdapter.ts` and backend `TD_CHAT_BACKEND`.

## How to run
```
./start.sh                 # installs what's missing, starts backend :8000 + frontend :5173, Ctrl+C stops both
./start.sh --prefetch      # download NASA data for the example cases first (needs backend/.env)
./start.sh --test          # backend tests + frontend build
# or by hand:
cd backend && .venv/bin/uvicorn app.main:app --port 8000 --reload
cd frontend && npm run dev        # http://localhost:5173 (proxies /api → :8000)
cd backend && .venv/bin/pytest -q
cd frontend && npm run build
```
