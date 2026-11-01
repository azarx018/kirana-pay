#!/usr/bin/env bash
# End-to-end: auth -> QRIS upload -> conversion -> tenant isolation -> API key.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENGINE_PORT="${ENGINE_PORT:-8082}"
API_PORT="${API_PORT:-3101}"
BASE="http://127.0.0.1:$API_PORT"
JAR_A=/tmp/kirana_a.jar; JAR_B=/tmp/kirana_b.jar
rm -f "$JAR_A" "$JAR_B"

cleanup() {
  [[ -n "${ENGINE_PID:-}" ]] && kill "$ENGINE_PID" 2>/dev/null || true
  [[ -n "${API_PID:-}" ]] && kill "$API_PID" 2>/dev/null || true
}
trap cleanup EXIT

fail() { echo "FAIL: $*"; exit 1; }

echo "==> build"
cargo build --quiet --manifest-path "$ROOT/services/qr-engine/Cargo.toml"
( cd "$ROOT/apps/api" && pnpm build >/dev/null )

echo "==> start services"
cd "$ROOT"
QR_ENGINE_PORT="$ENGINE_PORT" ./services/qr-engine/target/debug/qr-engine >/tmp/kirana-engine.log 2>&1 &
ENGINE_PID=$!
( cd "$ROOT/apps/api" && QR_ENGINE_URL="http://127.0.0.1:$ENGINE_PORT" PORT="$API_PORT" \
  DB_HOST="${DB_HOST:-127.0.0.1}" DB_USER="${DB_USER:-kirana}" DB_PASSWORD="${DB_PASSWORD:-kirana}" \
  DB_NAME="${DB_NAME:-kirana_pay}" exec node dist/main.js >/tmp/kirana-api.log 2>&1 ) &
API_PID=$!

for _ in $(seq 1 40); do curl -sf "$BASE/health" >/dev/null && break; sleep 1; done
curl -sf "$BASE/health" >/dev/null || { tail -20 /tmp/kirana-api.log; fail "api did not start"; }
echo "    health ok"

echo "==> fixture"
python3.12 - <<'PY'
import json, qrcode
g = json.load(open("services/qr-engine/testdata/golden.json"))
qrcode.make(g["static_payload"], box_size=10, border=2).save("/tmp/kirana_fixture.png")
PY

SUFFIX=$(date +%s)
A_EMAIL="owner-a-$SUFFIX@kirana.test"
B_EMAIL="owner-b-$SUFFIX@kirana.test"

echo "==> register merchant A + B"
curl -sf -c "$JAR_A" -X POST "$BASE/v1/auth/register" -H 'content-type: application/json' \
  -d "{\"email\":\"$A_EMAIL\",\"password\":\"rahasia-sekali-123\",\"merchantName\":\"Toko A\"}" >/tmp/a.json || fail "register A"
curl -sf -c "$JAR_B" -X POST "$BASE/v1/auth/register" -H 'content-type: application/json' \
  -d "{\"email\":\"$B_EMAIL\",\"password\":\"rahasia-sekali-123\",\"merchantName\":\"Toko B\"}" >/tmp/b.json || fail "register B"
grep -q '"success":true' /tmp/a.json || fail "register A payload"

echo "==> providers registry"
curl -sf -b "$JAR_A" "$BASE/v1/payment-providers" >/tmp/prov.json || fail "providers"
python3.12 - <<'PY'
import json
codes = [p["code"] for p in json.load(open("/tmp/prov.json"))["data"]]
assert codes == ["DANA_BUSINESS", "GOPAY_MERCHANT", "SHOPEEPAY_MERCHANT"], codes
print("    providers:", codes)
PY

echo "==> upload QRIS (A)"
QRIS_ID=$(curl -sf -b "$JAR_A" -X POST "$BASE/v1/qris" \
  -F "file=@/tmp/kirana_fixture.png;type=image/png" \
  -F "providerCode=DANA_BUSINESS" -F "displayName=QR Toko Utama" \
  | python3.12 -c 'import sys,json; d=json.load(sys.stdin); print(d["data"]["id"])')
[ -n "$QRIS_ID" ] || fail "qris upload"
echo "    qris=$QRIS_ID"

echo "==> reject unsupported provider"
CODE=$(curl -s -o /tmp/bad_provider.json -w '%{http_code}' -b "$JAR_A" -X POST "$BASE/v1/qris" \
  -F "file=@/tmp/kirana_fixture.png;type=image/png" -F "providerCode=NOPE" -F "displayName=X")
[ "$CODE" = "400" ] || fail "unsupported provider accepted ($CODE)"
grep -q 'UNSUPPORTED_PROVIDER' /tmp/bad_provider.json || fail "wrong error code for provider"

echo "==> convert via qrisId (A)"
curl -sf -b "$JAR_A" -X POST "$BASE/v1/qr/convert" -F "qrisId=$QRIS_ID" -F "amount=2300" \
  >/tmp/conv.json || fail "convert"
JOB_ID=$(python3.12 - <<'PY'
import json
d = json.load(open("/tmp/conv.json"))["data"]
assert d["amount"] == 2300, d
assert d["merchant"]["nmid"] == "ID9999999999999", d
print(d["id"])
PY
)
echo "    job=$JOB_ID"

echo "==> tenant isolation (B must not reach A)"
for path in "/v1/qris/$QRIS_ID" "/v1/qris/$QRIS_ID/image" "/v1/qr/$JOB_ID" "/v1/qr/$JOB_ID/image"; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR_B" "$BASE$path")
  [ "$CODE" = "404" ] || fail "cross-tenant read allowed on $path ($CODE)"
done
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR_B" -X POST "$BASE/v1/qr/convert" -F "qrisId=$QRIS_ID" -F "amount=1000")
[ "$CODE" = "404" ] || fail "cross-tenant convert allowed ($CODE)"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR_B" -X DELETE "$BASE/v1/qris/$QRIS_ID")
[ "$CODE" = "404" ] || fail "cross-tenant archive allowed ($CODE)"
echo "    cross-tenant requests rejected"

echo "==> merchant B list is empty"
curl -sf -b "$JAR_B" "$BASE/v1/qris" | python3.12 -c 'import sys,json; d=json.load(sys.stdin); assert d["data"]==[], d; print("    ok")'

echo "==> api key for A works, B key cannot touch A QRIS"
KEY_A=$(curl -sf -b "$JAR_A" -X POST "$BASE/v1/api-keys" -H 'content-type: application/json' \
  -d '{"name":"e2e"}' | python3.12 -c 'import sys,json; print(json.load(sys.stdin)["data"]["key"])')
KEY_B=$(curl -sf -b "$JAR_B" -X POST "$BASE/v1/api-keys" -H 'content-type: application/json' \
  -d '{"name":"e2e"}' | python3.12 -c 'import sys,json; print(json.load(sys.stdin)["data"]["key"])')
[ -n "$KEY_A" ] || fail "api key create"

CODE=$(curl -s -o /tmp/keyconv.json -w '%{http_code}' -X POST "$BASE/v1/qr/convert" -H "x-api-key: $KEY_A" -F "qrisId=$QRIS_ID" -F "amount=5000")
[ "$CODE" = "201" ] || fail "api key convert failed ($CODE)"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/v1/qr/convert" -H "x-api-key: $KEY_B" -F "qrisId=$QRIS_ID" -F "amount=5000")
[ "$CODE" = "404" ] || fail "api key crossed tenants ($CODE)"
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/v1/qris")
[ "$CODE" = "401" ] || fail "unauthenticated access allowed ($CODE)"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "x-api-key: kp_live_deadbeef" "$BASE/v1/qr?limit=1")
[ "$CODE" = "401" ] || fail "bogus api key accepted ($CODE)"
echo "    api key scoping ok"

echo "==> invoices: create, QR, tenancy, manual confirmation"
INV_JSON=$(curl -sf -b "$JAR_A" -X POST "$BASE/v1/invoices" -H 'content-type: application/json' \
  -d "{\"amount\":17000,\"description\":\"E2E kopi\",\"qrisId\":\"$QRIS_ID\",\"expiresInMinutes\":15}")
INV_ID=$(python3.12 - "$INV_JSON" <<'PY'
import json, sys
d = json.loads(sys.argv[1])["data"]
assert d["status"] == "PENDING", d
assert d["amount"] == 17000, d
assert d["publicId"].startswith("INV-"), d
assert d["paidAt"] is None, d
print(d["publicId"])
PY
)
[ -n "$INV_ID" ] || fail "invoice create"
echo "    invoice=$INV_ID status=PENDING"

CODE=$(curl -s -o /tmp/inv_qr.png -w '%{http_code}' -b "$JAR_A" "$BASE/v1/invoices/$INV_ID/qr")
[ "$CODE" = "200" ] || fail "invoice qr download ($CODE)"
python3.12 - <<'PY'
assert open("/tmp/inv_qr.png", "rb").read(8) == b"\x89PNG\r\n\x1a\n", "invoice QR is not a PNG"
PY
echo "    qr png ok"

CODE=$(curl -s -o /tmp/inv_key.json -w '%{http_code}' -X POST "$BASE/v1/invoices" \
  -H "x-api-key: $KEY_A" -H 'content-type: application/json' \
  -d "{\"amount\":4200,\"qrisId\":\"$QRIS_ID\"}")
[ "$CODE" = "201" ] || fail "api-key invoice create ($CODE)"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/v1/invoices/$INV_ID/confirm-payment" -H "x-api-key: $KEY_A")
[ "$CODE" = "401" ] || fail "api key could confirm payment ($CODE)"

for path in "/v1/invoices/$INV_ID" "/v1/invoices/$INV_ID/qr"; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR_B" "$BASE$path")
  [ "$CODE" = "404" ] || fail "cross-tenant invoice read allowed on $path ($CODE)"
done
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR_B" -X POST "$BASE/v1/invoices/$INV_ID/confirm-payment")
[ "$CODE" = "404" ] || fail "cross-tenant confirm allowed ($CODE)"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR_B" -X POST "$BASE/v1/invoices" -H 'content-type: application/json' \
  -d "{\"amount\":1000,\"qrisId\":\"$QRIS_ID\"}")
[ "$CODE" = "404" ] || fail "invoice with another merchant QRIS accepted ($CODE)"
echo "    tenant isolation ok"

CODE=$(curl -s -o /tmp/inv_bad.json -w '%{http_code}' -b "$JAR_A" -X POST "$BASE/v1/invoices" -H 'content-type: application/json' \
  -d "{\"amount\":10.5,\"qrisId\":\"$QRIS_ID\"}")
[ "$CODE" = "400" ] || fail "decimal amount accepted ($CODE)"
grep -q 'INVALID_AMOUNT' /tmp/inv_bad.json || fail "wrong code for decimal amount"

CODE=$(curl -s -o /tmp/inv_exp.json -w '%{http_code}' -b "$JAR_A" -X POST "$BASE/v1/invoices" -H 'content-type: application/json' \
  -d "{\"amount\":5000,\"qrisId\":\"$QRIS_ID\",\"expiresInMinutes\":4}")
[ "$CODE" = "400" ] || fail "expiry below minimum accepted ($CODE)"
grep -q 'INVALID_EXPIRY' /tmp/inv_exp.json || fail "wrong code for short expiry"
echo "    validation ok"

CONFIRMED=$(curl -sf -b "$JAR_A" -X POST "$BASE/v1/invoices/$INV_ID/confirm-payment")
python3.12 - "$CONFIRMED" "$A_EMAIL" <<'PY'
import json, sys
d = json.loads(sys.argv[1])["data"]
assert d["status"] == "PAID", d
assert d["paidAt"], d
assert d["confirmationMethod"] == "MANUAL_MERCHANT", d
assert d["confirmedBy"]["email"] == sys.argv[2], d
assert [e["type"] for e in d["events"]] == ["CREATED", "PAYMENT_CONFIRMED"], d
PY
echo "    confirmed PAID with audit data"

CODE=$(curl -s -o /tmp/inv_dup.json -w '%{http_code}' -b "$JAR_A" -X POST "$BASE/v1/invoices/$INV_ID/confirm-payment")
[ "$CODE" = "409" ] || fail "duplicate confirmation returned $CODE"
grep -q 'INVOICE_ALREADY_PAID' /tmp/inv_dup.json || fail "wrong code for duplicate confirmation"
COUNT=$(PGPASSWORD="${DB_PASSWORD:-kirana}" psql -h "${DB_HOST:-127.0.0.1}" -U "${DB_USER:-kirana}" -d "${DB_NAME:-kirana_pay}" -tAc \
  "SELECT count(*) FROM invoice_events WHERE \"invoiceId\" = (SELECT id FROM invoices WHERE \"publicId\" = '$INV_ID') AND type = 'PAYMENT_CONFIRMED'")
[ "$COUNT" = "1" ] || fail "duplicate audit events ($COUNT)"
echo "    idempotent confirmation ok"

EXP_INV=$(curl -sf -b "$JAR_A" -X POST "$BASE/v1/invoices" -H 'content-type: application/json' \
  -d "{\"amount\":9000,\"qrisId\":\"$QRIS_ID\",\"expiresInMinutes\":5}" \
  | python3.12 -c 'import sys,json; print(json.load(sys.stdin)["data"]["publicId"])')
PGPASSWORD="${DB_PASSWORD:-kirana}" psql -h "${DB_HOST:-127.0.0.1}" -U "${DB_USER:-kirana}" -d "${DB_NAME:-kirana_pay}" -q -c \
  "UPDATE invoices SET \"createdAt\" = now() - interval '2 minutes', \"expiresAt\" = now() - interval '1 minute' WHERE \"publicId\" = '$EXP_INV'"
CODE=$(curl -s -o /tmp/inv_gone.json -w '%{http_code}' -b "$JAR_A" -X POST "$BASE/v1/invoices/$EXP_INV/confirm-payment")
[ "$CODE" = "410" ] || fail "expired invoice confirmed ($CODE)"
grep -q 'INVOICE_EXPIRED' /tmp/inv_gone.json || fail "wrong code for expired invoice"
curl -sf -b "$JAR_A" "$BASE/v1/invoices/$EXP_INV" | python3.12 -c 'import sys,json; d=json.load(sys.stdin)["data"]; assert d["status"]=="EXPIRED", d; print("    expiry enforced")'

echo "==> revoke + archive"
KEY_ID=$(curl -sf -b "$JAR_A" "$BASE/v1/api-keys" | python3.12 -c 'import sys,json; print(json.load(sys.stdin)["data"][0]["id"])')
curl -sf -b "$JAR_A" -X DELETE "$BASE/v1/api-keys/$KEY_ID" >/dev/null
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/v1/qr/convert" -H "x-api-key: $KEY_A" -F "qrisId=$QRIS_ID" -F "amount=5000")
[ "$CODE" = "401" ] || fail "revoked key still works ($CODE)"
curl -sf -b "$JAR_A" -X DELETE "$BASE/v1/qris/$QRIS_ID" >/dev/null
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR_A" -X POST "$BASE/v1/qr/convert" -F "qrisId=$QRIS_ID" -F "amount=5000")
[ "$CODE" = "400" ] || fail "archived qris still convertible ($CODE)"
echo "    revocation + archive ok"

echo "==> logout invalidates session"
curl -sf -b "$JAR_A" -c "$JAR_A" -X POST "$BASE/v1/auth/logout" >/dev/null
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR_A" "$BASE/v1/qris")
[ "$CODE" = "401" ] || fail "session still valid after logout ($CODE)"

echo
echo "E2E PASSED"
