# Deploy: morning checklist

One Docker container serves everything: FastAPI at `/api`, the built React app at `/` (index.html fallback).
It is a long-running process, so the in-memory job store and background jobs work as in local dev.
Primary host: **Render** (`render.yaml`). Alternative: **Fly.io** (`fly.toml`, `.github/workflows/deploy-fly.yml`).
CI (`.github/workflows/ci.yml`) runs on every push and PR: backend pytest, frontend typecheck + build, and a
smoke test that builds the Docker image, runs it and checks health, variables, an analysis to `done`, CSV,
`/api/grid` and the frontend (`scripts/smoke.sh`). Deploys happen only after CI is green.

## What you need

- A GitHub account/org for the repo (empty repo, no README).
- Render account (free) logged in with GitHub — or a Fly.io account + `flyctl` if you choose Fly.
- Later: the Earthdata token for real NASA data, as a `TD_` environment variable set in the host's
  dashboard (never in git). Nothing secret is needed today: NOAA and the geocoder are public.

## 1. GitHub (both hosts)

```bash
cd <path-to-this-repo>
git remote add origin git@github.com:<you>/<repo>.git
git push -u origin main          # the pre-push hook runs tests + build first (~1.5 min)
```

Check the **Actions** tab: `CI` should go green (backend, frontend, smoke). Optional but recommended:
Settings → Branches → protect `main`, require the `CI` checks for PRs.

## 2a. Render (primary)

1. Render dashboard → **New → Blueprint** → pick the repo → it reads `render.yaml` → **Apply**.
2. Wait for the first build (~3–5 min). Open `https://<service>.onrender.com`, check `/api/health`.
3. Done. `autoDeployTrigger: checksPass` means every push to `main` deploys **only after all GitHub checks
   on that commit pass**; a red CI never deploys. (Service → Settings → Build & Deploy → Auto-Deploy should
   show "After CI Checks Pass".)
4. Env vars: Service → Environment. Defaults are in `render.yaml` (`TD_DATA_PROVIDER=auto`,
   `TD_GRID_PREWARM=false`). Add secrets (e.g. the Earthdata token) there.

Free plan notes: the service sleeps after ~15 min idle (first request then takes ~1 min) — open the URL a
few minutes before the demo. 512 MB RAM: measured locally, idle ~165 MB, a map trend grid peaks ~400 MB,
the startup grid prewarm peaks ~560 MB (hence disabled). If you see restarts/OOM in the logs, upgrade to an
instance with ≥1 GB (Standard) or use Fly with 1 GB.

## 2b. Fly.io (alternative)

```bash
fly auth login
fly launch --copy-config --no-deploy --name <app-name>   # keep fly.toml; set app name there
fly deploy --ha=false                                    # first deploy from your machine
fly scale count 1                                        # ONE machine: jobs live in memory
fly tokens create deploy -x 999999h                      # -> GitHub secret FLY_API_TOKEN
```

GitHub → Settings → Secrets and variables → Actions: secret `FLY_API_TOKEN`, variable `FLY_DEPLOY=true`.
From then on `deploy-fly.yml` deploys the exact commit CI tested, only when CI on `main` succeeded.
Env/secrets: `fly secrets set TD_...=...`. (If you pick Render, leave `FLY_DEPLOY` unset; the workflow skips.)

## Rollback

- Render: Service → **Events/Deploys** → pick the last good deploy → **Rollback**. Then fix forward with
  `git revert <bad-sha> && git push` (CI → auto-deploy).
- Fly: `fly releases` → `fly deploy --image <image of the good release>` (shown by `fly releases --image`),
  or `git revert` + push.

## Local checks

```bash
scripts/install-hooks.sh                 # pre-push guard (already installed in this clone)
docker build -t trend-detective . && docker run --rm -p 8200:8000 trend-detective
scripts/smoke.sh http://localhost:8200
# without Docker: build the frontend, then
cd backend && TD_STATIC_DIR=../frontend/dist .venv/bin/uvicorn app.main:app --port 8200
```

## Behaviour on the host

- Run exactly **one worker/process** (the Dockerfile does): jobs and uploads are per-process memory/disk.
- Cache and uploads live in `/app/data` inside the container (`TD_CACHE_DIR`, `TD_UPLOAD_DIR`) and are
  **ephemeral**: a redeploy or a Render sleep/wake clears uploaded datasets and finished jobs. Fine for the demo.
- NOAA CO₂/CH₄: downloaded on first use; if NOAA is unreachable the bundled copies in
  `backend/app/data/seed/noaa_gml/` are used (real data, as fresh as the last commit of those files).
  Refresh them with `cd backend && .venv/bin/python -m app.prefetch && cp data/cache/noaa_gml/*.txt app/data/seed/noaa_gml/`.
- Frontend calls same-origin `/api`. To point a separately hosted frontend at this backend, build it with
  `VITE_API_BASE=https://<backend>/api` and set `TD_CORS_ORIGINS='["https://<frontend-origin>"]'` on the backend.
