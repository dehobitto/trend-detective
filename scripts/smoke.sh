#!/usr/bin/env bash
# End-to-end smoke test against a running single-container deploy (API + built frontend).
#   scripts/smoke.sh http://localhost:8200
# Checks: /api/health, /api/variables, POST /api/analyses -> poll to done, CSV, /api/grid, GET / is index.html.
set -euo pipefail
BASE="${1:-http://localhost:8000}"
BASE="${BASE%/}"
fail() { echo "SMOKE FAIL: $*" >&2; exit 1; }
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }

echo "-> waiting for $BASE/api/health"
for _ in $(seq 1 60); do
  curl -fsS "$BASE/api/health" >/dev/null 2>&1 && break
  sleep 1
done
health=$(curl -fsS "$BASE/api/health") || fail "health not reachable"
[ "$(echo "$health" | json 'd["status"]')" = ok ] || fail "health: $health"
echo "   health ok: $health"

n=$(curl -fsS "$BASE/api/variables" | json 'len(d)')
[ "$n" -gt 0 ] || fail "no variables"
echo "   variables: $n"

body='{"variable_id":"gldas_gws","bbox":{"west":74,"south":29,"east":77,"north":32},"start":"2004-01-01","end":"2020-12-31","aggregation":"monthly","deseasonalize":true,"alpha":0.05}'
job=$(curl -fsS -X POST -H 'Content-Type: application/json' -d "$body" "$BASE/api/analyses") || fail "POST /api/analyses"
id=$(echo "$job" | json 'd["id"]')
status=""
for _ in $(seq 1 60); do
  status=$(curl -fsS "$BASE/api/analyses/$id" | json 'd["status"]')
  [ "$status" = done ] || [ "$status" = error ] && break
  sleep 0.5
done
[ "$status" = done ] || fail "analysis $id ended as '$status'"
echo "   analysis $id: done ($(curl -fsS "$BASE/api/analyses/$id" | json 'd["result"]["summary"]'))"
curl -fsS "$BASE/api/analyses/$id/csv" | head -1 | grep -q '^date,value' || fail "CSV header"
echo "   csv ok"

grid=$(curl -fsS "$BASE/api/grid/gldas_gws?date=2010-01-01&res=2" | json 'd["width"]*d["height"]')
[ "$grid" -gt 0 ] || fail "grid empty"
echo "   grid cells: $grid"

curl -fsS "$BASE/" | grep -qi '<div id="root"' || fail "GET / did not return index.html"
curl -fsS "$BASE/some/client/route" | grep -qi '<div id="root"' || fail "SPA fallback"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/no-such-endpoint")
[ "$code" = 404 ] || fail "unknown API path returned $code, expected 404"
asset=$(curl -fsS "$BASE/" | grep -o '/assets/[^"]*\.js' | head -1)
[ -n "$asset" ] && curl -fsS -o /dev/null "$BASE$asset" || fail "JS asset $asset"
echo "   frontend ok (index.html, SPA fallback, $asset)"
echo "SMOKE OK"
