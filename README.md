# Kirana Pay — Backend MVP 0.1

Static QRIS in, amount-specific QR checkout out. Kirana Pay is **not** a wallet: it never
holds funds. The QR is generated from the merchant's own QRIS; money flows through the
merchant's acquirer as usual.

Scope of this MVP is the backend only (see `docs/kirana_pay_backend_mvp_ai_brief.md`).

## Stack

| Component | Tech | Port |
|---|---|---|
| `apps/api` | NestJS 11 + TypeScript + TypeORM (+ static dashboard) | 3000 |
| `services/qr-engine` | Rust + Axum | 8081 (internal) |
| PostgreSQL | 16 | 5432 |

The QR engine is never exposed publicly: it is reached by the API over the internal network.

## Local setup

```bash
# 1. dependencies
pnpm install
cargo build --release --manifest-path services/qr-engine/Cargo.toml

# 2. database (local PostgreSQL)
sudo -u postgres psql -c "CREATE USER kirana WITH PASSWORD 'kirana';"
sudo -u postgres psql -c "CREATE DATABASE kirana_pay OWNER kirana;"

# 3. env
cp apps/api/.env.example apps/api/.env

# 4. run the QR engine
QR_ENGINE_PORT=8081 ./services/qr-engine/target/release/qr-engine

# 5. run the API (second terminal)
cd apps/api && pnpm start:dev
```

Dashboard: <http://localhost:3000/> · Swagger: <http://localhost:3000/docs> · Health: <http://localhost:3000/health>

The dashboard is a static page served by the API (`apps/api/public`, no build step): upload a
static QRIS image, set an amount, optional note, then download or scan the generated QR. It
needs the API key stored locally in the browser (top-right field).

## Try it

```bash
curl -X POST http://localhost:3000/v1/qr/convert \
  -H "x-api-key: dev-local-key" \
  -F "file=@static-qris.png;type=image/png" \
  -F "amount=2300" \
  -F "note=TES KEDUA"

curl -H "x-api-key: dev-local-key" http://localhost:3000/v1/qr/<id>
```

## Tests

```bash
pnpm --filter @kirana-pay/api test                 # unit tests (Jest)
cargo test --manifest-path services/qr-engine/Cargo.toml   # 23 tests (unit + parity + HTTP)
bash scripts/e2e.sh                                # full upload -> QR -> metadata flow
```

The parity tests compare the Rust transformer byte-for-byte against golden vectors produced
by the proven Python converter (`services/qr-engine/testdata/golden.json`).

## Docker deployment

```bash
cp .env.example .env          # set API_KEY and DB_PASSWORD
docker compose up -d --build
docker compose ps
curl -s http://127.0.0.1:3200/health
```

What runs:

| service | host port | exposed to |
|---|---|---|
| api | `${API_HOST_PORT:-3200} -> 3000` | outside (API + `/docs`) |
| qr-engine | none | internal network only |
| postgres | none | internal network only |

Operational notes:

- `sudo` is required to talk to the Docker socket on this VM (user is not in the `docker` group).
- Logs: `docker compose logs -f api` / `docker compose logs -f qr-engine`.
- Restart policy is `unless-stopped`; data lives in the `pgdata` and `qrdata` volumes.
- Update after code changes: `docker compose up -d --build api qr-engine`.
- The API container keeps generated PNGs in `/app/var/qr` (volume `qrdata`).

## Known limitations (read before production)

- QR generation is **not** proof that a payment can be processed. Real payments must be
  verified with the relevant payment app/acquirer; see `docs/architecture.md`.
- MVP auth is a single static API key (`x-api-key`). Replace it with user/merchant scoped
  credentials before exposing the API.
- `DB_SYNCHRONIZE=true` is for development; use migrations in production.
- No payment status tracking: this MVP only produces QR images.
