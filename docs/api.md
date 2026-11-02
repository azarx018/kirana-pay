# API — v1

Base URL: `http://localhost:3000` · Swagger: `/docs` · Dashboard: `/`

## Authentication

Two ways to authenticate. Both resolve to a **merchant context**; every query is scoped to it.

1. **Session cookie** (dashboard): `POST /v1/auth/login` sets `kirana_session`, httpOnly, SameSite=Lax, 14 days.
2. **Merchant API key** (programmatic, server-to-server): `Authorization: Bearer kp_live_…` (preferred) or the
   legacy `x-api-key: kp_live_…`. Never in a query string or body. Sending both headers with different values
   is rejected (`401`). Keep keys on your server, never in browser code.

Routes that accept an API key: `/v1/qr/*` and `/v1/invoices` (create, list, detail, qr), each **gated by a scope**
(below). Everything else requires a session. No API key can ever confirm a payment.

Errors always use:

```json
{ "success": false, "error": { "code": "UNSUPPORTED_PROVIDER", "message": "..." } }
```

| Code | HTTP | Meaning |
|---|---|---|
| `INVALID_EMAIL` / `WEAK_PASSWORD` | 400 | registration input invalid |
| `EMAIL_TAKEN` | 409 | email already registered |
| `INVALID_CREDENTIALS` | 401 | wrong email/password |
| `UNAUTHORIZED` | 401 | no session, or invalid / revoked / expired API key (one generic message) |
| `INSUFFICIENT_SCOPE` | 403 | the API key lacks the scope this route needs |
| `INVALID_FILE_TYPE` | 400 | missing/empty file, not PNG/JPEG |
| `FILE_TOO_LARGE` | 400/413 | exceeds `MAX_UPLOAD_BYTES` |
| `INVALID_AMOUNT` | 400 | not a positive integer in range |
| `UNSUPPORTED_PROVIDER` | 400 | providerCode unknown or inactive |
| `INVALID_DISPLAY_NAME` | 400 | QR display name missing/too long |
| `QRIS_ARCHIVED` | 400 | converting an archived QRIS |
| `QR_NOT_READABLE` | 400/422 | no decodable QR in the image |
| `UNSUPPORTED_QR_FORMAT` | 400/422 | readable, but not a supported QRIS payload |
| `QR_VALIDATION_FAILED` | 400/422 | QRIS structure invalid |
| `QR_ENGINE_UNAVAILABLE` | 400 | engine timeout/down |
| `NOT_FOUND` | 404 | resource missing **or owned by another merchant** |
| `INTERNAL_ERROR` | 500 | unexpected (details never leaked) |

Registration and login are rate limited (5 and 8 requests/minute/IP).

## Auth

| Method | Path | Description |
|---|---|---|
| POST | `/v1/auth/register` | `{email, password, merchantName?, displayName?}` → creates user + merchant + OWNER membership + session |
| POST | `/v1/auth/login` | `{email, password}` → session cookie |
| POST | `/v1/auth/logout` | clears the session row and cookie |
| GET | `/v1/auth/me` | current user, merchant, role |

Password hashing: Argon2id (`@node-rs/argon2`, m=19456 KiB, t=2, p=1).
Password reset is **not implemented**: this deployment has no email delivery configured.

## Merchant

| Method | Path | Description |
|---|---|---|
| GET | `/v1/merchant` | current merchant profile + role |
| PATCH | `/v1/merchant` | `{name?, phone?}` |

## Providers

`GET /v1/payment-providers` → active providers from the seeded registry:

```json
{ "success": true, "data": [
  { "id": "…", "code": "DANA_BUSINESS", "name": "DANA Business" },
  { "id": "…", "code": "GOPAY_MERCHANT", "name": "GoPay Merchant" },
  { "id": "…", "code": "SHOPEEPAY_MERCHANT", "name": "ShopeePay Merchant" }
]}
```

The provider is **merchant-supplied metadata**, never inferred from the payload, and it does not
prove the QR is accepted by that provider.

## QRIS (merchant owned, multiple per merchant)

| Method | Path | Description |
|---|---|---|
| POST | `/v1/qris` | multipart `file`, `providerCode`, `displayName` |
| GET | `/v1/qris` | list for the current merchant (ACTIVE + ARCHIVED) |
| GET | `/v1/qris/:id` | detail with provider + display name |
| GET | `/v1/qris/:id/image` | original uploaded image (merchant scoped) |
| PUT | `/v1/qris/:id/image` | replace image (re-validated by the QR engine) |
| DELETE | `/v1/qris/:id` | archive (soft delete) |

Upload validates: size, magic bytes, and that the QR engine can decode a supported QRIS payload.
`nmid` / `merchantName` are read from the payload at upload time (informational only).

```bash
curl -X POST http://localhost:3000/v1/qris \
  -b cookies.txt \
  -F "file=@qris.png;type=image/png" \
  -F "providerCode=DANA_BUSINESS" \
  -F "displayName=QR Toko Utama"
```

## QR conversion

`POST /v1/qr/convert` — multipart, accepts `qrisId` **or** `file`:

| field | required | notes |
|---|---|---|
| `qrisId` | one of these | stored QRIS owned by the current merchant |
| `file` | one of these | ad-hoc upload, not persisted |
| `amount` | yes | integer rupiah |
| `note` | no | max 25 chars, tag 62/05 |

```bash
# with a stored QRIS
curl -X POST http://localhost:3000/v1/qr/convert -H "x-api-key: kp_live_…" \
  -F "qrisId=583d44fb-…" -F "amount=2300" -F "note=INV-001"
```

```json
{
  "success": true,
  "data": {
    "id": "43665d64-…",
    "status": "generated",
    "amount": 2300,
    "currency": "IDR",
    "merchant": { "nmid": "ID9999999999999", "name": "TOKO CONTOH" },
    "qrImage": { "mimeType": "image/png", "data": "iVBORw0KGgo…" }
  }
}
```

`GET /v1/qr?limit=10` and `GET /v1/qr/:id` return metadata for the **current merchant only**.
`GET /v1/qr/:id/image` returns the generated PNG.

## API keys

Session + **owner** only. A key belongs to exactly one merchant; only its SHA-256 hash is stored and the full
secret is returned **once** (create / rotate, with `Cache-Control: no-store`).

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/api-keys` | list: prefix, scopes, `status` (`ACTIVE`/`REVOKED`/`EXPIRED`), `expiresAt`, `lastUsedAt`, `rotatedFromId` (never the secret) |
| POST | `/v1/api-keys` | `{name?, scopes?, expiresAt?}` → `key` returned once |
| DELETE | `/v1/api-keys/:id` | revoke: immediate, idempotent (keeps the first `revokedAt`) |
| POST | `/v1/api-keys/:id/rotate` | atomic: old key dies at once (no grace period), new key inherits name, scopes and expiry |

**Scopes** (enforced before any business logic; sessions are not scope-limited):

| Scope | Allows |
|---|---|
| `invoices:read` | `GET /v1/invoices`, `/v1/invoices/:id`, `/v1/invoices/:id/qr` |
| `invoices:write` | `POST /v1/invoices` |
| `qr:convert` | `/v1/qr/*` (convert and read your own QR jobs) |
| `payment_links:read`, `payment_links:write` | reserved for the Developer API payment-link routes |

There is deliberately **no scope that marks an invoice paid**. If `scopes` is omitted on create, the pre-V4 default
(`invoices:read`, `invoices:write`, `qr:convert`) is applied so the existing dashboard keeps working; keys that existed
before V4 were backfilled with exactly that set. `expiresAt` is optional (future, within 366 days); an expired key
behaves like a revoked one. A revoked or expired key cannot be rotated (`409 API_KEY_REVOKED` / `API_KEY_EXPIRED`).
`lastUsedAt` is refreshed at most every 5 minutes, not on every request.

## Invoices (MVP V2)

Invoices are merchant-scoped, amount-specific QR requests with an explicit lifecycle.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/v1/invoices` | session or API key | create a PENDING invoice + generate its QR |
| GET | `/v1/invoices` | session or API key | list; `limit` (1–50, default 20), `before` (ISO cursor), `status`, `qrisId` |
| GET | `/v1/invoices/:id` | session or API key | detail by public id (`INV-…`) or uuid, incl. audit events |
| GET | `/v1/invoices/:id/qr` | session or API key | PNG of the invoice QR |
| POST | `/v1/invoices/:id/confirm-payment` | **session only** | manual merchant confirmation PENDING → PAID |

Create body:

```json
{ "amount": 25000, "description": "Kopi susu", "qrisId": "uuid", "expiresInMinutes": 60 }
```

- `amount` — integer rupiah, `MIN_AMOUNT`..`MAX_AMOUNT`, never floating point.
- `description` — optional, trimmed, max 200 chars.
- `qrisId` — must be an **ACTIVE** QRIS owned by the calling merchant, else `404`.
- `expiresInMinutes` — 5…10080, default 60 (`INVOICE_*_TTL_MINUTES` env). Expiry is stored in UTC
  and returned as ISO 8601; the backend enforces it (lazy sweep, no scheduler).

Statuses: `PENDING` → `PAID` (manual merchant confirmation) or `EXPIRED` (past `expiresAt`).
`PAID` and `EXPIRED` are terminal. There is no `CANCELLED` in this milestone.

Semantics that the API guarantees:

- Creating an invoice or generating/downloading its QR **never** marks it paid.
- `confirm-payment` requires a session cookie: an API key has no user identity to audit, so it gets
  `401`. The acting user id and server timestamp are recorded, `confirmationMethod = MANUAL_MERCHANT`.
- Confirmation is atomic and idempotent: a second call returns `409 INVOICE_ALREADY_PAID` and writes
  no additional audit event. Expired invoices return `410 INVOICE_EXPIRED` — expiry never overwrites
  `PAID`.
- Cross-tenant ids return `404`, same as ids that do not exist.

| Code | HTTP | Meaning |
|---|---|---|
| `INVALID_AMOUNT` | 400 | not a positive integer within configured bounds |
| `INVALID_EXPIRY` | 400 | outside 5…10080 minutes or not an integer |
| `INVALID_DESCRIPTION` | 400 | longer than 200 characters |
| `QRIS_ARCHIVED` | 400 | selected QRIS is archived |
| `INVOICE_ALREADY_PAID` | 409 | duplicate manual confirmation |
| `INVOICE_EXPIRED` | 410 | invoice already expired |

Audit: every invoice has append-only `invoice_events` rows (`CREATED`, `PAYMENT_CONFIRMED`,
`EXPIRED`) with actor and timestamp, returned in the detail payload.

## Payment links (MVP V3)

A payment link is a public, revocable URL for **one existing invoice**. It never creates an invoice and
never verifies payment. Full contract (field lists, error codes): `docs/v3/CONTRACT.md`.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/v1/invoices/:id/payment-link` | **session only** | create or return the active link (`201` new, `200` existing) |
| GET | `/v1/invoices/:id/payment-link` | **session only** | latest link (`{ "link": null }` if none) |
| DELETE | `/v1/invoices/:id/payment-link` | **session only** | revoke the active link, permanently |
| GET | `/v1/public/payment-links/:token` | none (rate limited 60/min/IP) | customer page data |

Guarantees:

- One ACTIVE link per invoice, enforced by a partial unique index; repeated and concurrent creates return
  the same link. A revoked link is dead forever; a replacement gets a new token.
- Creating a link for a `PAID` invoice returns `409 INVOICE_ALREADY_PAID`, for an expired one
  `410 INVOICE_EXPIRED`. Without `PUBLIC_BASE_URL`/`PAYMENT_LINK_SECRET` in production: `503 PAYMENT_LINK_NOT_CONFIGURED`.
- Token = 16-byte random nonce + truncated HMAC-SHA256 (44 chars). Only the nonce is stored, so a database
  leak alone cannot produce a working URL. The MAC is verified before any database access. Changing
  `PAYMENT_LINK_SECRET` invalidates every existing link.
- The public endpoint is read-only. State is `PAYABLE`, `PAID` or `EXPIRED`; the QR (`qrImageDataUrl`) is
  present **only** while `PAYABLE`. Expiry is judged with the database clock and never persisted by a public
  read. Invalid, malformed, unknown and revoked tokens all return the identical
  `404 PAYMENT_LINK_UNAVAILABLE`. Responses carry `Cache-Control: no-store` and `X-Robots-Tag: noindex, nofollow`.
- Only approved fields are exposed (merchant name, invoice reference, description, amount, currency, dates,
  state, QR). No internal ids, QRIS data, emails or phone numbers.
- Link audit (creator, revoker, timestamps) lives on `payment_links`; `invoice_events` is unchanged.
- Environment: `PUBLIC_BASE_URL` (public origin, used to build `/pay/<token>`), `PAYMENT_LINK_SECRET` (>= 32 chars).

## Tenant isolation

Every merchant-owned query filters by the merchant derived from the credential. Cross-tenant
requests return **404** (existence is not leaked). Covered by `scripts/e2e.sh`.
