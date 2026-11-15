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
- If the backend is down when the page loads, the app falls back to the offline demo until reload:
  start the backend first.
- All data except Mauna Loa CO2 / NOAA CO2+CH4 / uploads is synthetic ("Demo data" badge).
- `requirements.txt` unpinned; Docker image never built locally (first build will be in CI).
- Bundle chunks > 1 MB (three.js, maplibre); fine for a demo.

## Next steps (need you)
1. GitHub repo + Render (or Fly) account → follow `docs/DEPLOY.md` (CI, pre-push hook, auto-deploy on checks pass).
   Render: use a 1 GB instance (trend grid peaks ~400 MB).
2. Earthdata token as env var (never in chat/git) → wire real GES DISC / AppEEARS providers
   (`backend/app/providers/nasa_giovanni.py`, `appeears.py`), verify product IDs in `catalog/variables.yaml`.
3. Teammate's chatbot: swap `frontend/src/features/chat/chatAdapter.ts` and backend `TD_CHAT_BACKEND`.

## How to run
```
cd backend && .venv/bin/uvicorn app.main:app --port 8000 --reload
cd frontend && npm run dev        # http://localhost:5173 (proxies /api → :8000)
cd backend && .venv/bin/pytest -q
cd frontend && npm run build
```
