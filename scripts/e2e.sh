#!/usr/bin/env bash
# End-to-end check: upload a static QRIS image -> dynamic QR -> metadata.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENGINE_PORT="${ENGINE_PORT:-8082}"
API_PORT="${API_PORT:-3101}"
API_KEY="${API_KEY:-dev-local-key}"
GO="./services/qr-engine/target/debug/qr-engine"

cleanup() {
  [[ -n "${ENGINE_PID:-}" ]] && kill "$ENGINE_PID" 2>/dev/null || true
  [[ -n "${API_PID:-}" ]] && kill "$API_PID" 2>/dev/null || true
}
trap cleanup EXIT

echo "==> building"
cargo build --quiet --manifest-path "$ROOT/services/qr-engine/Cargo.toml"
( cd "$ROOT/apps/api" && pnpm build >/dev/null )

echo "==> starting qr-engine :$ENGINE_PORT"
cd "$ROOT"
QR_ENGINE_PORT="$ENGINE_PORT" "$GO" >/tmp/kirana-engine.log 2>&1 &
ENGINE_PID=$!

echo "==> starting api :$API_PORT"
( cd "$ROOT/apps/api" && QR_ENGINE_URL="http://127.0.0.1:$ENGINE_PORT" PORT="$API_PORT" \
  API_KEY="$API_KEY" \
  DB_HOST="${DB_HOST:-127.0.0.1}" DB_USER="${DB_USER:-kirana}" \
  DB_PASSWORD="${DB_PASSWORD:-kirana}" DB_NAME="${DB_NAME:-kirana_pay}" \
  node dist/main.js >/tmp/kirana-api.log 2>&1 ) &
API_PID=$!

for _ in $(seq 1 30); do
  curl -sf "http://127.0.0.1:$API_PORT/health" >/dev/null && break
  sleep 1
done
curl -sf "http://127.0.0.1:$API_PORT/health" >/dev/null || { echo "api failed to start"; tail -20 /tmp/kirana-api.log; exit 1; }
echo "    health ok"

echo "==> rendering fixture from golden vectors"
python3.12 - <<'PY'
import json, qrcode
g = json.load(open("services/qr-engine/testdata/golden.json"))
qrcode.make(g["static_payload"], box_size=10, border=2).save("/tmp/kirana_fixture.png")
PY

echo "==> POST /v1/qr/convert"
curl -sf -X POST "http://127.0.0.1:$API_PORT/v1/qr/convert" \
  -H "x-api-key: $API_KEY" \
  -F "file=@/tmp/kirana_fixture.png;type=image/png" \
  -F "amount=2300" \
  -F "note=TES KEDUA" > /tmp/kirana_resp.json

python3.12 - <<'PY'
import json, base64, sys
r = json.load(open("/tmp/kirana_resp.json"))
assert r["success"] is True, r
d = r["data"]
assert d["amount"] == 2300, d
assert d["merchant"]["nmid"] == "ID9999999999999", d
png = base64.b64decode(d["qrImage"]["data"])
assert png[:8] == b"\x89PNG\r\n\x1a\n", "not a png"
open("/tmp/kirana_out.png", "wb").write(png)
open("/tmp/kirana_id.txt", "w").write(d["id"])
print("    convert ok:", d["id"], len(png), "bytes")
PY

echo "==> GET /v1/qr/:id"
curl -sf -H "x-api-key: $API_KEY" "http://127.0.0.1:$API_PORT/v1/qr/$(cat /tmp/kirana_id.txt)" | tee /tmp/kirana_meta.json
echo

echo "E2E PASSED"
