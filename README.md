# Kirana Pay — Backend + Dashboard (v1: multi-tenant)

Static QRIS in, amount-specific QR checkout out. Kirana Pay never holds funds: the QR is
generated from a merchant's own QRIS and money flows through that merchant's acquirer.

## Stack

| Component | Tech | Port |
|---|---|---|
| `apps/api` | NestJS 11 + TypeORM + PostgreSQL + static dashboard | 3000 |
| `apps/web` | Next.js 15 dashboard (light/dark, invoice + QR flows) | 3100 |
| `services/qr-engine` | Rust + Axum (decode, validate, transform, render) | 8081 internal |
| PostgreSQL | 16 | 5432 internal |

## Invoices (MVP V2)

`POST /v1/invoices` creates a merchant-scoped invoice with a fixed amount and its own QR, generated
by the same Rust engine. An invoice is `PENDING` until a signed-in merchant user explicitly confirms
receipt (`POST /v1/invoices/:id/confirm-payment`), which records the acting user, a server timestamp
and a `PAYMENT_CONFIRMED` audit event. Generating, viewing or downloading a QR never marks anything
paid, and expiry (`PENDING` → `EXPIRED`, lazily enforced, default 60 minutes) never overwrites
`PAID`. Full contract and error codes: `docs/api.md`.

## Model

```text
users ──< merchant_members >── merchants ──< merchant_qris >── payment_providers
                                   │
                                   ├──< qr_jobs
                                   └──< api_keys
```

- `payment_providers` is a seeded registry (`DANA_BUSINESS`, `GOPAY_MERCHANT`, `SHOPEEPAY_MERCHANT`).
- A QRIS row has **one merchant**, **one provider**, and its own **display name** — the provider
  is never inferred from the payload and never replaced by the display name.
- Every merchant-owned query is filtered by the merchant derived from the credential.

## Local setup

```bash
pnpm install
cargo build --manifest-path services/qr-engine/Cargo.toml

cp apps/api/.env.example apps/api/.env      # DB + storage config
# database
sudo -u postgres psql -c "CREATE USER kirana WITH PASSWORD 'kirana';"
sudo -u postgres psql -c "CREATE DATABASE kirana_pay OWNER kirana;"

QR_ENGINE_PORT=8081 ./services/qr-engine/target/debug/qr-engine   # terminal 1
cd apps/api && pnpm start:dev                                      # terminal 2
```

Schema: TypeORM **migrations** run automatically on boot (`migrationsRun: true`), including the
idempotent provider seed. `synchronize` is off.

Open <http://localhost:3000/> → register a merchant → add a QRIS (provider + display name) →
generate a QR. Swagger: `/docs`. Health: `/health`.

## API in one minute

```bash
# register (creates user + merchant + OWNER membership, sets session cookie)
curl -c c.txt -X POST localhost:3000/v1/auth/register -H 'content-type: application/json' \
  -d '{"email":"owner@toko.id","password":"rahasia-sekali-123","merchantName":"Toko Utama"}'

# add a QRIS (provider selection is required and explicit)
curl -b c.txt -X POST localhost:3000/v1/qris \
  -F "file=@qris.png;type=image/png" -F "providerCode=DANA_BUSINESS" -F "displayName=QR Toko Utama"

# generate an amount-specific QR from that stored QRIS
curl -b c.txt -X POST localhost:3000/v1/qr/convert -F "qrisId=<id>" -F "amount=2300"
```

Programmatic clients use a merchant-scoped key (`x-api-key: kp_live_…`) created in
**Pengaturan → API key**; the plaintext is shown once. Full contract: `docs/api.md`.

## Tests

```bash
pnpm --filter @kirana-pay/api test                          # unit tests
cargo test --manifest-path services/qr-engine/Cargo.toml    # 28 tests (unit + parity + HTTP)
bash scripts/e2e.sh                                         # auth, QRIS, tenancy, API keys
```

`scripts/e2e.sh` proves, against a running stack: registration, provider registry, QRIS upload,
conversion, **cross-tenant reads/writes rejected (404)**, API-key scoping, revocation, archive,
and logout invalidation.

## Docker deployment

```bash
cp .env.example .env          # DB_PASSWORD, API_HOST_PORT
docker compose up -d --build
docker compose ps
```

Services: `api` (host port `${API_HOST_PORT:-3200}`), `qr-engine` and `postgres` (internal only).
Runbook, Tailscale access and ops commands: `docs/deploy.md`.

## Known limitations

- **QR generation is not proof of payment acceptance.** Provider selection is merchant-supplied
  metadata; acceptance must be tested through the real merchant/provider flow.
- Password reset is not implemented (no email delivery in this deployment).
- Sessions are DB-backed cookies; CSRF relies on SameSite=Lax + JSON/multipart APIs.
- `var/qr` local storage is the MVP driver; the `FileStorage` interface is swappable for S3.
- No payment status, webhooks, invoices or payment links yet (out of scope for v1).
