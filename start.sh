#!/usr/bin/env bash
# Start Trend Detective for local development: FastAPI backend (:8000) + Vite frontend (:5173).
#
#   ./start.sh              install what's missing, start both, Ctrl+C stops both
#   ./start.sh --prefetch   also download the real NASA data for the example cases first (needs backend/.env)
#   ./start.sh --test       run the backend tests and the frontend build, then exit
#
# A port that is already in use is assumed to be our server running elsewhere: it is left alone.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
API_PORT=8000
WEB_PORT=5173

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }
port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

command -v python3 >/dev/null || die "python3 not found"
command -v npm >/dev/null || die "npm not found (install Node.js 18+)"

# --- dependencies -------------------------------------------------------------------------------------
if [ ! -x "$BACKEND/.venv/bin/python" ]; then
  say "Creating backend virtualenv"
  python3 -m venv "$BACKEND/.venv"
fi
REQ_STAMP="$BACKEND/.venv/.requirements.sha"
REQ_SHA="$(sha1sum "$BACKEND/requirements.txt" | cut -d' ' -f1)"
if [ "$(cat "$REQ_STAMP" 2>/dev/null || true)" != "$REQ_SHA" ]; then
  say "Installing backend requirements"
  "$BACKEND/.venv/bin/pip" install -q --upgrade pip
  "$BACKEND/.venv/bin/pip" install -q -r "$BACKEND/requirements.txt"
  echo "$REQ_SHA" > "$REQ_STAMP"
fi
if [ ! -d "$FRONTEND/node_modules" ] || [ "$FRONTEND/package.json" -nt "$FRONTEND/node_modules" ]; then
  say "Installing frontend packages"
  (cd "$FRONTEND" && npm install --no-fund --no-audit)
  touch "$FRONTEND/node_modules"
fi

if [ ! -f "$BACKEND/.env" ]; then
  warn "No backend/.env: example cases still work from the bundled seed, new areas need an Earthdata login."
  warn "Copy backend/.env.example to backend/.env and fill in TD_EARTHDATA_USERNAME / TD_EARTHDATA_PASSWORD."
fi

# --- one-shot modes -----------------------------------------------------------------------------------
case "${1:-}" in
  --test)
    say "Backend tests"
    (cd "$BACKEND" && .venv/bin/python -m pytest -q)
    say "Frontend type check + build"
    (cd "$FRONTEND" && npm run build)
    exit 0
    ;;
  --prefetch)
    say "Prefetching NASA data for the example cases (can take a while the first time)"
    (cd "$BACKEND" && .venv/bin/python -m app.prefetch) || warn "Prefetch finished with failures (see above); starting anyway."
    ;;
  "") ;;
  *) die "Unknown option: $1 (use --prefetch or --test)" ;;
esac

# --- servers ------------------------------------------------------------------------------------------
PIDS=()
cleanup() {
  trap - INT TERM EXIT
  if [ ${#PIDS[@]} -gt 0 ]; then
    say "Stopping"
    kill "${PIDS[@]}" 2>/dev/null || true
    wait "${PIDS[@]}" 2>/dev/null || true
  fi
}
trap cleanup INT TERM EXIT

if port_busy "$API_PORT"; then
  warn "Port $API_PORT is busy: using the backend that is already running there."
else
  say "Backend  -> http://localhost:$API_PORT  (API docs: /docs)"
  (cd "$BACKEND" && exec .venv/bin/uvicorn app.main:app --reload --port "$API_PORT") &
  PIDS+=($!)
fi

if port_busy "$WEB_PORT"; then
  warn "Port $WEB_PORT is busy: using the frontend that is already running there."
else
  say "Frontend -> http://localhost:$WEB_PORT"
  (cd "$FRONTEND" && exec npm run dev -- --port "$WEB_PORT") &
  PIDS+=($!)
fi

if [ ${#PIDS[@]} -eq 0 ]; then
  say "Both servers were already running. Open http://localhost:$WEB_PORT"
  trap - INT TERM EXIT
  exit 0
fi

# Wait for the API, then say where to go.
for _ in $(seq 1 60); do
  port_busy "$API_PORT" && break
  sleep 0.5
done
say "Ready: open http://localhost:$WEB_PORT   (Ctrl+C stops everything this script started)"
wait -n "${PIDS[@]}" || true
warn "A server exited; stopping the other one."
