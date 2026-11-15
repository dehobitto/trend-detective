# Status notes (2026-11-15, afternoon)

## State
- Backend: `pytest` 100 passed. Frontend: `npm run build` passes.
- All data is real. Every example case was run on real NASA/NOAA data and its takeaway checked against the
  numbers (default dates). The cases' series are committed in `backend/app/data/seed/cache/` (3.6 MB) and
  installed into the cache at startup: with an empty cache and no internet, every case answers in ~0.2 s.

| Case | Real result |
|---|---|
| Punjab groundwater / rain | GWS −69 mm/decade, significant; rain no significant trend |
| Delhi NO₂ | no significant trend since 2005; clear dips in the 2020 and 2021 lockdown springs |
| China (North China Plain) | MERRA-2 sulfate −40% since 2011, significant; MERRA-2 SO₂ flat (follows older emission estimates) |
| Phoenix | night LST +0.94 °C/decade, significant; day no significant trend |
| Rondônia | NDVI falling, significant |
| Sahel | NDVI and rain both rising, significant |
| Delhi night lights | +40% since 2012, significant; NO₂ over the same area not significant |
| Mauna Loa CO₂, global CH₄ | rising, significant |

## Done today
- MODIS moved from AppEEARS (its queue took hours) to MOD11C3 / MOD13C2 monthly 0.05° grids over LP DAAC
  OPeNDAP: ~30–70 s for any new area, so MODIS works for user-drawn areas too.
- Night lights (LAADS) work: CMR version fix (`2`, not `002`), Earthdata profile + "LAADS Web" approval.
  Big areas are sampled with an OPeNDAP stride (≤ 40k pixels per month) and the result says so.
- Live download progress ("Downloading from NASA: N of M files"); the frontend gives up only after 3 min with
  no progress (was a hard 120 s, which killed first-time OMI downloads).
- Rectangles under 0.25° are enlarged with a map note instead of being dropped silently.
- Named regions (other session): pick a country/state/city in search, the OSM boundary is approximated by
  squares and only those are averaged (`/api/regions/shape`, `cells` on the request).
- Docs (API, SPEC, DEPLOY, backend README, `.env.example`, `render.yaml`/`fly.toml` secrets) updated.

## Known issues
- First download for a new area: ~25–70 s (monthly products), 2–4 min (OMI NO₂), ~2 min for a city's night
  lights and ~6 min for a 5°×5° area (time is set by the number of requests, not their size).
- OMI NO₂ is sampled on 4 days per month and GLDAS on the 1st: long trends are fine, single months are noisier.
- MODIS is 0.05° (~5 km): fine for city-sized areas and up, coarse for a single field or district.
- Example takeaways are fixed text checked for the default dates: if a student changes a case's dates, the
  chart may tell a different story than the takeaway.
- `appeears` provider is kept but unused (no catalog variable routes to it).
- Pinch globe → map not tested on a real phone. Bundle chunks > 1 MB (three.js, maplibre).
- `requirements.txt` unpinned; Docker image never built locally (first build will be in CI).

## Next steps
1. Comparing two areas side by side ("where is it changing?": opposite trends in different regions).
2. Teammate's chatbot: swap `frontend/src/features/chat/chatAdapter.ts` and backend `TD_CHAT_BACKEND`.
3. Deploy: `docs/DEPLOY.md` (set the three Earthdata secrets on the host).

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
# after changing or adding an example case:
cd backend && .venv/bin/python -m app.prefetch && .venv/bin/python -m app.prefetch --save-seed   # then commit
```
