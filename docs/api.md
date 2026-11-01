# API — v1

Base URL: `http://localhost:3000` · Swagger: `/docs` · Dashboard: `/`

## Authentication

Two ways to authenticate. Both resolve to a **merchant context**; every query is scoped to it.

1. **Session cookie** (dashboard): `POST /v1/auth/login` sets `kirana_session`, httpOnly, SameSite=Lax, 14 days.
2. **Merchant API key** (programmatic): header `x-api-key: kp_live_…`.

`/v1/qr/*` accepts either. Every other `/v1/*` route requires a session.

Errors always use:

```json
{ "success": false, "error": { "code": "UNSUPPORTED_PROVIDER", "message": "..." } }
```

| Code | HTTP | Meaning |
|---|---|---|
| `INVALID_EMAIL` / `WEAK_PASSWORD` | 400 | registration input invalid |
| `EMAIL_TAKEN` | 409 | email already registered |
| `INVALID_CREDENTIALS` | 401 | wrong email/password |
| `UNAUTHORIZED` | 401 | no session, invalid/revoked API key |
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

| Method | Path | Description |
|---|---|---|
| GET | `/v1/api-keys` | list (prefix + status; never the secret) |
| POST | `/v1/api-keys` | `{name?}` → `key` returned **once** |
| DELETE | `/v1/api-keys/:id` | revoke |
| POST | `/v1/api-keys/:id/rotate` | revoke + create replacement (returns new plaintext once) |

Keys are stored as SHA-256 hashes with a `kp_live_…` prefix shown in the UI.

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

## Tenant isolation

Every merchant-owned query filters by the merchant derived from the credential. Cross-tenant
requests return **404** (existence is not leaked). Covered by `scripts/e2e.sh`.
