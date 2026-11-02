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
  PUBLIC_BASE_URL="http://pay.e2e.test" PAYMENT_LINK_SECRET="e2e-payment-link-secret-not-for-prod-0123456789" \
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

echo "==> payment links (MVP V3)"
db() { PGPASSWORD="${DB_PASSWORD:-kirana}" psql -h "${DB_HOST:-127.0.0.1}" -p "${DB_PORT:-5432}" -U "${DB_USER:-kirana}" -d "${DB_NAME:-kirana_pay}" -tAc "$1"; }
chk() { python3.12 - "$1" "$2" <<'PY'
import json, os, sys
d = json.load(open(sys.argv[1]))
assert eval(sys.argv[2], {"d": d, "os": os}), (sys.argv[2], d)
PY
}
mk_invoice() {
  curl -sf -b "$JAR_A" -X POST "$BASE/v1/invoices" -H 'content-type: application/json' \
    -d "{\"amount\":$1,\"description\":\"$2\",\"qrisId\":\"$QRIS_ID\",\"expiresInMinutes\":15}" \
    | python3.12 -c 'import sys,json; print(json.load(sys.stdin)["data"]["publicId"])'
}
link_count() { db "SELECT count(*) FROM payment_links WHERE \"invoiceId\" = (SELECT id FROM invoices WHERE \"publicId\" = '$1') AND ($2)"; }
pub() { curl -s -o "$2" -w '%{http_code}' "$BASE/v1/public/payment-links/$1"; }

export PL1; PL1=$(mk_invoice 11000 '<img src=x onerror=alert(1)> kopi')
[ -n "$PL1" ] || fail "payment link invoice"

for m in POST GET DELETE; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -X "$m" "$BASE/v1/invoices/$PL1/payment-link")
  [ "$CODE" = "401" ] || fail "anonymous $m payment-link ($CODE)"
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "x-api-key: $KEY_A" -X "$m" "$BASE/v1/invoices/$PL1/payment-link")
  [ "$CODE" = "401" ] || fail "api key $m payment-link ($CODE)"
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR_B" -X "$m" "$BASE/v1/invoices/$PL1/payment-link")
  [ "$CODE" = "404" ] || fail "cross-tenant $m payment-link ($CODE)"
done
[ "$(link_count "$PL1" true)" = "0" ] || fail "link rows created by rejected callers"
echo "    anonymous / api key / other tenant rejected"

CODE=$(curl -s -o /tmp/pl_create.json -w '%{http_code}' -b "$JAR_A" -X POST "$BASE/v1/invoices/$PL1/payment-link")
[ "$CODE" = "201" ] || fail "create payment link ($CODE)"
chk /tmp/pl_create.json 'd["success"] and d["data"]["created"] is True and d["data"]["link"]["status"]=="ACTIVE" and set(d["data"]["link"])=={"status","url","createdAt","createdBy","revokedAt","revokedBy"}'
PL_URL=$(python3.12 -c 'import json; print(json.load(open("/tmp/pl_create.json"))["data"]["link"]["url"])')
echo "$PL_URL" | grep -Eq '^http://pay\.e2e\.test/pay/[A-Za-z0-9_-]{44}$' || fail "payment link url shape ($PL_URL)"
PL_TOKEN="${PL_URL##*/}"
CODE=$(curl -s -o /tmp/pl_again.json -w '%{http_code}' -b "$JAR_A" -X POST "$BASE/v1/invoices/$PL1/payment-link")
[ "$CODE" = "200" ] || fail "repeat create should be 200 ($CODE)"
chk /tmp/pl_again.json "d['data']['created'] is False and d['data']['link']['url']=='$PL_URL'"
curl -sf -b "$JAR_A" "$BASE/v1/invoices/$PL1/payment-link" >/tmp/pl_get.json || fail "get payment link"
chk /tmp/pl_get.json "d['data']['link']['url']=='$PL_URL' and d['data']['link']['createdBy']['email']=='$A_EMAIL'"
[ "$(link_count "$PL1" true)" = "1" ] || fail "repeat create made a second link"
echo "    create + idempotent repeat + get ok"

PL2=$(mk_invoice 12000 'konkuren')
PAR_PIDS=()
for i in $(seq 1 10); do
  curl -s -o "/tmp/pl_par_$i.json" -w '%{http_code}\n' -b "$JAR_A" -X POST "$BASE/v1/invoices/$PL2/payment-link" &
  PAR_PIDS+=($!)
done >/tmp/pl_par_codes.txt
# wait only for the curls: a bare `wait` would also block on the API/engine started above
wait "${PAR_PIDS[@]}"
python3.12 - <<'PY'
import json
codes = open("/tmp/pl_par_codes.txt").read().split()
assert len(codes) == 10 and set(codes) <= {"200", "201"}, codes
assert codes.count("201") == 1, codes
urls = {json.load(open(f"/tmp/pl_par_{i}.json"))["data"]["link"]["url"] for i in range(1, 11)}
assert len(urls) == 1, urls
PY
[ "$(link_count "$PL2" "\"status\" = 'ACTIVE'")" = "1" ] || fail "concurrent creates left more than one active link"
if db "INSERT INTO payment_links (\"invoiceId\", \"tokenNonce\") SELECT id, 'ZZZZZZZZZZZZZZZZZZZZZZ' FROM invoices WHERE \"publicId\" = '$PL2'" >/dev/null 2>&1; then
  fail "database allowed a second active link"
fi
echo "    10 concurrent creates -> exactly one active link (db enforced)"

CODE=$(curl -s -D /tmp/pl_pub.hdr -o /tmp/pl_pub.json "$BASE/v1/public/payment-links/$PL_TOKEN" -w '%{http_code}')
[ "$CODE" = "200" ] || fail "public resolve ($CODE)"
grep -qi '^cache-control: no-store' /tmp/pl_pub.hdr || fail "public response is cacheable"
grep -qi '^x-robots-tag: noindex' /tmp/pl_pub.hdr || fail "public response is indexable"
chk /tmp/pl_pub.json 'set(d["data"])=={"state","merchantName","invoice","qrImageDataUrl","serverTime"} and d["data"]["state"]=="PAYABLE" and d["data"]["merchantName"]=="Toko A" and d["data"]["invoice"]["reference"]==os.environ["PL1"] and d["data"]["invoice"]["amount"]==11000 and d["data"]["invoice"]["description"].startswith("<img") and set(d["data"]["invoice"])=={"reference","description","amount","currency","createdAt","expiresAt","paidAt"}'
python3.12 - <<'PY'
import base64, json
url = json.load(open("/tmp/pl_pub.json"))["data"]["qrImageDataUrl"]
assert url.startswith("data:image/png;base64,"), url[:30]
assert base64.b64decode(url.split(",", 1)[1])[:8] == b"\x89PNG\r\n\x1a\n", "public QR is not a PNG"
PY
if grep -Eq "$A_EMAIL|passwordHash|qrPath|merchantId|qrisId|ID9999999999999|var/qr" /tmp/pl_pub.json; then
  fail "public payload leaks private data"
fi
echo "    public page data ok (no auth, no-store, noindex, no private fields)"

FORGED="${PL_TOKEN:0:43}$([ "${PL_TOKEN:43:1}" = "A" ] && echo B || echo A)"
FIRST=""
for t in "$FORGED" "$(printf 'A%.0s' $(seq 1 44))" "short" "$PL1" "$(python3.12 -c 'print("x"*500)')"; do
  CODE=$(pub "$t" /tmp/pl_bad.json)
  [ "$CODE" = "404" ] || fail "invalid token answered $CODE"
  grep -q 'PAYMENT_LINK_UNAVAILABLE' /tmp/pl_bad.json || fail "invalid token wrong error code"
  [ -n "$FIRST" ] || FIRST=$(cat /tmp/pl_bad.json)
  [ "$(cat /tmp/pl_bad.json)" = "$FIRST" ] || fail "invalid tokens produce different bodies"
done
echo "    forged / malformed / invoice-id tokens -> identical 404"

for m in POST PUT PATCH DELETE; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -X "$m" "$BASE/v1/public/payment-links/$PL_TOKEN")
  [ "$CODE" = "404" ] || fail "public endpoint accepted $m ($CODE)"
done
curl -sf -b "$JAR_A" "$BASE/v1/invoices/$PL1" | python3.12 -c 'import sys,json; d=json.load(sys.stdin)["data"]; assert d["status"]=="PENDING" and d["paidAt"] is None and [e["type"] for e in d["events"]]==["CREATED"], d'
echo "    public access never mutates the invoice"

curl -sf -b "$JAR_A" -X POST "$BASE/v1/invoices/$PL1/confirm-payment" >/dev/null || fail "confirm for payment link invoice"
CODE=$(pub "$PL_TOKEN" /tmp/pl_paid.json)
[ "$CODE" = "200" ] || fail "paid public resolve ($CODE)"
chk /tmp/pl_paid.json 'd["data"]["state"]=="PAID" and d["data"]["qrImageDataUrl"] is None and d["data"]["invoice"]["paidAt"]'
CODE=$(curl -s -o /tmp/pl_paid_create.json -w '%{http_code}' -b "$JAR_A" -X POST "$BASE/v1/invoices/$PL1/payment-link")
[ "$CODE" = "409" ] || fail "create on paid invoice returned $CODE"
grep -q 'INVOICE_ALREADY_PAID' /tmp/pl_paid_create.json || fail "wrong code for paid invoice"
curl -sf -b "$JAR_A" -X DELETE "$BASE/v1/invoices/$PL1/payment-link" >/dev/null || fail "revoke on paid invoice"
CODE=$(pub "$PL_TOKEN" /dev/null)
[ "$CODE" = "404" ] || fail "revoked link of paid invoice still served ($CODE)"
echo "    paid: QR hidden, no new link, revoke kills the page"

PL3=$(mk_invoice 13000 'cabut')
T1=$(curl -sf -b "$JAR_A" -X POST "$BASE/v1/invoices/$PL3/payment-link" | python3.12 -c 'import sys,json; print(json.load(sys.stdin)["data"]["link"]["url"].rsplit("/",1)[1])')
[ "$(pub "$T1" /dev/null)" = "200" ] || fail "link not served before revoke"
CODE=$(curl -s -o /tmp/pl_rev.json -w '%{http_code}' -b "$JAR_A" -X DELETE "$BASE/v1/invoices/$PL3/payment-link")
[ "$CODE" = "200" ] || fail "revoke ($CODE)"
chk /tmp/pl_rev.json "d['data']['link']['status']=='REVOKED' and d['data']['link']['url'] is None and d['data']['link']['revokedBy']['email']=='$A_EMAIL'"
CODE=$(pub "$T1" /tmp/pl_rev_pub.json)
[ "$CODE" = "404" ] || fail "revoked link still served ($CODE)"
grep -q 'PAYMENT_LINK_UNAVAILABLE' /tmp/pl_rev_pub.json || fail "revoked link wrong error"
CODE=$(curl -s -o /tmp/pl_rev2.json -w '%{http_code}' -b "$JAR_A" -X DELETE "$BASE/v1/invoices/$PL3/payment-link")
[ "$CODE" = "404" ] || fail "second revoke returned $CODE"
grep -q 'PAYMENT_LINK_NOT_FOUND' /tmp/pl_rev2.json || fail "second revoke wrong code"
curl -sf -b "$JAR_A" "$BASE/v1/invoices/$PL3/payment-link" | python3.12 -c 'import sys,json; l=json.load(sys.stdin)["data"]["link"]; assert l["status"]=="REVOKED" and l["url"] is None, l'
T2=$(curl -sf -b "$JAR_A" -X POST "$BASE/v1/invoices/$PL3/payment-link" | python3.12 -c 'import sys,json; d=json.load(sys.stdin)["data"]; assert d["created"] is True; print(d["link"]["url"].rsplit("/",1)[1])')
[ "$T1" != "$T2" ] || fail "replacement link reused the revoked token"
[ "$(pub "$T1" /dev/null)" = "404" ] || fail "old token came back to life"
[ "$(pub "$T2" /dev/null)" = "200" ] || fail "replacement link not served"
[ "$(link_count "$PL3" true)" = "2" ] && [ "$(link_count "$PL3" "\"status\" = 'ACTIVE'")" = "1" ] && [ "$(link_count "$PL3" "\"revokedByUserId\" IS NOT NULL")" = "1" ] || fail "link history not preserved"
echo "    revoke -> dead forever; replacement gets a new token; history kept"

PL4=$(mk_invoice 14000 'kedaluwarsa')
T4=$(curl -sf -b "$JAR_A" -X POST "$BASE/v1/invoices/$PL4/payment-link" | python3.12 -c 'import sys,json; print(json.load(sys.stdin)["data"]["link"]["url"].rsplit("/",1)[1])')
db "UPDATE invoices SET \"createdAt\" = now() - interval '2 minutes', \"expiresAt\" = now() - interval '1 minute' WHERE \"publicId\" = '$PL4'" >/dev/null
CODE=$(pub "$T4" /tmp/pl_exp.json)
[ "$CODE" = "200" ] || fail "expired public resolve ($CODE)"
chk /tmp/pl_exp.json 'd["data"]["state"]=="EXPIRED" and d["data"]["qrImageDataUrl"] is None'
[ "$(db "SELECT status FROM invoices WHERE \"publicId\" = '$PL4'")" = "PENDING" ] || fail "public read persisted EXPIRED (must be read-only)"
CODE=$(curl -s -o /tmp/pl_exp_create.json -w '%{http_code}' -b "$JAR_A" -X POST "$BASE/v1/invoices/$PL4/payment-link")
[ "$CODE" = "410" ] || fail "create on expired invoice returned $CODE"
grep -q 'INVOICE_EXPIRED' /tmp/pl_exp_create.json || fail "wrong code for expired invoice"
CODE=$(pub "$T4" /tmp/pl_exp2.json)
chk /tmp/pl_exp2.json 'd["data"]["state"]=="EXPIRED" and d["data"]["qrImageDataUrl"] is None'
echo "    expiry judged server-side, read-only, QR hidden, create refused (410)"

for tok in "$PL_TOKEN" "$T1" "$T2" "$T4"; do
  # -F: literal match; -e: tokens may start with "-" and must not be parsed as grep options
  if grep -qF -e "$tok" /tmp/kirana-api.log; then fail "a payment link token appears in the API log"; fi
done

RL=0
for _ in $(seq 1 75); do
  C=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/v1/public/payment-links/$T2")
  if [ "$C" = "429" ]; then RL=$((RL + 1)); fi
done
[ "$RL" -ge 1 ] || fail "public endpoint is not rate limited"
echo "    public endpoint rate limited ($RL x 429); tokens absent from logs"

echo "==> api keys: scopes, bearer, expiry, revoke, rotate (V4)"
kcall() { curl -s -o /tmp/k.json -w '%{http_code}' "$@"; }
pj() { python3.12 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(eval(sys.argv[2]))' "$1" "$2"; }
JSON='content-type: application/json'
mkkey() { # $1 = JSON body ; sets KEY_ID / KEY_PLAIN
  curl -s -D /tmp/k.hdr -b "$JAR_A" -X POST "$BASE/v1/api-keys" -H "$JSON" -d "$1" -o /tmp/k_new.json
  KEY_ID=$(pj /tmp/k_new.json 'd["data"]["id"]'); KEY_PLAIN=$(pj /tmp/k_new.json 'd["data"]["key"]')
}

# validation
for body in '{"scopes":[]}' '{"scopes":["admin"]}' '{"scopes":["invoices:read","invoices:confirm"]}' '{"scopes":"invoices:read"}'; do
  CODE=$(kcall -b "$JAR_A" -X POST "$BASE/v1/api-keys" -H "$JSON" -d "$body")
  [ "$CODE" = "400" ] || fail "key create accepted bad scopes $body ($CODE)"
done
CODE=$(kcall -b "$JAR_A" -X POST "$BASE/v1/api-keys" -H "$JSON" -d '{"scopes":["invoices:read"],"expiresAt":"2020-01-01T00:00:00Z"}')
[ "$CODE" = "400" ] && grep -q INVALID_EXPIRY /tmp/k.json || fail "past expiry accepted ($CODE)"

# legacy-compatible default scopes (the pre-V4 dashboard sends only a name)
mkkey '{"name":"legacy"}'
chk /tmp/k_new.json 'd["data"]["scopes"]==["invoices:read","invoices:write","qr:convert"] and d["data"]["status"]=="ACTIVE" and d["data"]["key"].startswith("kp_live_")'
grep -qi '^cache-control: no-store' /tmp/k.hdr || fail "issued key response is cacheable"
K_LEG="$KEY_PLAIN"
[ "$(kcall -H "Authorization: Bearer $K_LEG" "$BASE/v1/invoices")" = "200" ] || fail "legacy key via Bearer"
[ "$(kcall -H "x-api-key: $K_LEG" "$BASE/v1/invoices")" = "200" ] || fail "legacy key via x-api-key"
[ "$(kcall -H "x-api-key: $K_LEG" "$BASE/v1/qr")" = "200" ] || fail "legacy key lost /v1/qr access"
echo "    omitted scopes -> legacy defaults; Bearer and x-api-key both work"

# plaintext never stored; list never returns it
EXPECTED_HASH=$(printf '%s' "$K_LEG" | sha256sum | cut -d' ' -f1)
[ "$(db "SELECT \"keyHash\" FROM api_keys WHERE id = '$KEY_ID'")" = "$EXPECTED_HASH" ] || fail "stored value is not the SHA-256 hash"
[ "$(db "SELECT count(*) FROM api_keys WHERE \"keyHash\" = '$K_LEG'")" = "0" ] || fail "plaintext key stored"
curl -sf -b "$JAR_A" "$BASE/v1/api-keys" -o /tmp/k_list.json
if grep -qF -e "$K_LEG" /tmp/k_list.json; then fail "list endpoint leaks the key"; fi
chk /tmp/k_list.json 'all("key" not in k and "keyHash" not in k for k in d["data"])'
echo "    only the hash is stored; list never returns the key"

# scope enforcement happens before business logic
mkkey '{"name":"read-only","scopes":["invoices:read"]}'; K_RO="$KEY_PLAIN"; K_RO_ID="$KEY_ID"
INV_BEFORE=$(db "SELECT count(*) FROM invoices")
CODE=$(kcall -H "Authorization: Bearer $K_RO" -X POST "$BASE/v1/invoices" -H "$JSON" -d "{\"amount\":9000,\"qrisId\":\"$QRIS_ID\"}")
[ "$CODE" = "403" ] && grep -q INSUFFICIENT_SCOPE /tmp/k.json || fail "read-only key created an invoice ($CODE)"
[ "$(db "SELECT count(*) FROM invoices")" = "$INV_BEFORE" ] || fail "403 still created an invoice"
[ "$(kcall -H "x-api-key: $K_RO" "$BASE/v1/qr")" = "403" ] || fail "read-only key reached /v1/qr"
[ "$(kcall -H "x-api-key: $K_RO" "$BASE/v1/invoices")" = "200" ] || fail "read-only key cannot read"
mkkey '{"name":"write-only","scopes":["invoices:write"]}'; K_WO="$KEY_PLAIN"
[ "$(kcall -H "x-api-key: $K_WO" "$BASE/v1/invoices")" = "403" ] || fail "write-only key can read"
[ "$(kcall -H "Authorization: Bearer $K_WO" -X POST "$BASE/v1/invoices" -H "$JSON" -d "{\"amount\":9100,\"qrisId\":\"$QRIS_ID\"}")" = "201" ] || fail "write key cannot create"
echo "    insufficient scope -> 403 before any work"

# no key can ever mark an invoice paid
for k in "$K_LEG" "$K_WO" "$K_RO"; do
  CODE=$(kcall -H "Authorization: Bearer $k" -X POST "$BASE/v1/invoices/$PL2/confirm-payment")
  [ "$CODE" = "401" ] || fail "API key reached confirm-payment ($CODE)"
done
[ "$(db "SELECT status FROM invoices WHERE \"publicId\" = '$PL2'")" = "PENDING" ] || fail "an API key changed invoice status"
echo "    API keys cannot confirm payment (401), invoice still PENDING"

# ambiguous / misplaced credentials
[ "$(kcall -H "Authorization: Bearer $K_LEG" -H "x-api-key: $K_RO" "$BASE/v1/invoices")" = "401" ] || fail "conflicting headers accepted"
[ "$(kcall "$BASE/v1/invoices?api_key=$K_LEG&x-api-key=$K_LEG")" = "401" ] || fail "key in query string accepted"
[ "$(kcall -H "Authorization: Bearer ${K_LEG}x" "$BASE/v1/invoices")" = "401" ] || fail "tampered key accepted"
if grep -qF -e "$K_LEG" /tmp/k.json; then fail "401 body echoes the key"; fi
echo "    conflicting headers / query-string keys / tampered keys -> 401"

# tenant isolation of key management
[ "$(kcall -b "$JAR_B" -X DELETE "$BASE/v1/api-keys/$K_RO_ID")" = "404" ] || fail "merchant B revoked A's key"
[ "$(kcall -b "$JAR_B" -X POST "$BASE/v1/api-keys/$K_RO_ID/rotate")" = "404" ] || fail "merchant B rotated A's key"
[ "$(kcall -H "x-api-key: $K_RO" "$BASE/v1/invoices")" = "200" ] || fail "A's key broke after B's attempts"
echo "    other merchant cannot revoke or rotate"

# last-used is throttled, not written on every request
sleep 1
LU1=$(db "SELECT extract(epoch FROM \"lastUsedAt\") FROM api_keys WHERE id = '$K_RO_ID'")
[ -n "$LU1" ] || fail "lastUsedAt not recorded"
kcall -H "x-api-key: $K_RO" "$BASE/v1/invoices" >/dev/null; sleep 1
[ "$(db "SELECT extract(epoch FROM \"lastUsedAt\") FROM api_keys WHERE id = '$K_RO_ID'")" = "$LU1" ] || fail "lastUsedAt written on every request"
echo "    lastUsedAt recorded once, not rewritten per request"

# expiry
mkkey "{\"name\":\"short\",\"scopes\":[\"invoices:read\"],\"expiresAt\":\"$(date -u -d '+1 hour' +%Y-%m-%dT%H:%M:%SZ)\"}"
K_EXP="$KEY_PLAIN"; K_EXP_ID="$KEY_ID"
[ "$(kcall -H "x-api-key: $K_EXP" "$BASE/v1/invoices")" = "200" ] || fail "unexpired key rejected"
db "UPDATE api_keys SET \"expiresAt\" = now() - interval '1 minute' WHERE id = '$K_EXP_ID'" >/dev/null
[ "$(kcall -H "x-api-key: $K_EXP" "$BASE/v1/invoices")" = "401" ] || fail "expired key accepted"
curl -sf -b "$JAR_A" "$BASE/v1/api-keys" -o /tmp/k_list.json
chk /tmp/k_list.json "[k for k in d['data'] if k['id']=='$K_EXP_ID'][0]['status']=='EXPIRED'"
CODE=$(kcall -b "$JAR_A" -X POST "$BASE/v1/api-keys/$K_EXP_ID/rotate")
[ "$CODE" = "409" ] && grep -q API_KEY_EXPIRED /tmp/k.json || fail "expired key was rotated ($CODE)"
echo "    expired key -> 401, shown as EXPIRED, cannot be rotated"

# revoke: immediate, idempotent, permanent
mkkey '{"name":"to-revoke","scopes":["invoices:read"]}'; K_REV="$KEY_PLAIN"; K_REV_ID="$KEY_ID"
[ "$(kcall -H "x-api-key: $K_REV" "$BASE/v1/invoices")" = "200" ] || fail "fresh key rejected"
[ "$(kcall -b "$JAR_A" -X DELETE "$BASE/v1/api-keys/$K_REV_ID")" = "200" ] || fail "revoke"
[ "$(kcall -H "x-api-key: $K_REV" "$BASE/v1/invoices")" = "401" ] || fail "revoked key still works"
REV_AT=$(db "SELECT extract(epoch FROM \"revokedAt\") FROM api_keys WHERE id = '$K_REV_ID'")
[ "$(kcall -b "$JAR_A" -X DELETE "$BASE/v1/api-keys/$K_REV_ID")" = "200" ] || fail "second revoke not idempotent"
[ "$(db "SELECT extract(epoch FROM \"revokedAt\") FROM api_keys WHERE id = '$K_REV_ID'")" = "$REV_AT" ] || fail "second revoke rewrote revokedAt"
[ -n "$(db "SELECT \"revokedByUserId\" FROM api_keys WHERE id = '$K_REV_ID'")" ] || fail "revoker not recorded"
CODE=$(kcall -b "$JAR_A" -X POST "$BASE/v1/api-keys/$K_REV_ID/rotate")
[ "$CODE" = "409" ] && grep -q API_KEY_REVOKED /tmp/k.json || fail "revoked key was rotated ($CODE)"
[ "$(kcall -H "x-api-key: $K_REV" "$BASE/v1/invoices")" = "401" ] || fail "revoked key came back"
echo "    revoke immediate + idempotent; revoked key can never return"

# rotate: atomic, inherits scopes/expiry, old key dies at once
mkkey "{\"name\":\"rot\",\"scopes\":[\"invoices:read\",\"qr:convert\"],\"expiresAt\":\"$(date -u -d '+30 days' +%Y-%m-%dT%H:%M:%SZ)\"}"
K_OLD="$KEY_PLAIN"; K_OLD_ID="$KEY_ID"; OLD_EXP=$(pj /tmp/k_new.json 'd["data"]["expiresAt"]')
CODE=$(kcall -b "$JAR_A" -X POST "$BASE/v1/api-keys/$K_OLD_ID/rotate")
[ "$CODE" = "201" ] || fail "rotate ($CODE)"
K_NEW=$(pj /tmp/k.json 'd["data"]["key"]')
chk /tmp/k.json "d['data']['id']!='$K_OLD_ID' and d['data']['rotatedFromId']=='$K_OLD_ID' and d['data']['scopes']==['invoices:read','qr:convert'] and d['data']['expiresAt']=='$OLD_EXP' and d['data']['status']=='ACTIVE'"
[ "$K_NEW" != "$K_OLD" ] || fail "rotation reused the key"
[ "$(kcall -H "x-api-key: $K_OLD" "$BASE/v1/invoices")" = "401" ] || fail "old key survived rotation"
[ "$(kcall -H "Authorization: Bearer $K_NEW" "$BASE/v1/invoices")" = "200" ] || fail "new key rejected"
[ -n "$(db "SELECT \"revokedByUserId\" FROM api_keys WHERE id = '$K_OLD_ID'")" ] || fail "rotation actor not recorded"
echo "    rotate: new key inherits scopes+expiry, old key dead immediately"

mkkey '{"name":"race","scopes":["invoices:read"]}'; RACE_ID="$KEY_ID"
RPIDS=()
for i in 1 2 3 4 5; do
  curl -s -o /dev/null -w '%{http_code}\n' -b "$JAR_A" -X POST "$BASE/v1/api-keys/$RACE_ID/rotate" &
  RPIDS+=($!)
done >/tmp/k_race.txt
wait "${RPIDS[@]}"
[ "$(grep -c '^201$' /tmp/k_race.txt)" = "1" ] && [ "$(grep -c '^409$' /tmp/k_race.txt)" = "4" ] || fail "concurrent rotation: $(tr '\n' ' ' </tmp/k_race.txt)"
[ "$(db "SELECT count(*) FROM api_keys WHERE \"rotatedFromId\" = '$RACE_ID'")" = "1" ] || fail "concurrent rotation made more than one successor"
echo "    5 concurrent rotations -> exactly one successor"

for k in "$K_LEG" "$K_RO" "$K_WO" "$K_EXP" "$K_REV" "$K_OLD" "$K_NEW"; do
  if grep -qF -e "$k" /tmp/kirana-api.log; then fail "an API key appears in the API log"; fi
done
echo "    no key appears in the API log"

echo "==> revoke + archive"
# select KEY_A by its hash: the list is newest-first and other keys exist by now
KEY_ID=$(db "SELECT id FROM api_keys WHERE \"keyHash\" = '$(printf '%s' "$KEY_A" | sha256sum | cut -d' ' -f1)'")
[ -n "$KEY_ID" ] || fail "could not locate KEY_A"
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
