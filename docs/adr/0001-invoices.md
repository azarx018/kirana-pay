# ADR 0001 — Invoice lifecycle (MVP V2)

Status: accepted · Scope: `POST/GET /v1/invoices`, dashboard "Invoice" tab

## Context

Kirana Pay could already turn a stored static QRIS into an amount-specific QR (`qr_jobs`), but it had
no concept of a bill, no expiry, and no way for a merchant to record that money actually arrived.
The tempting shortcut — treating "QR generated" or "QR downloaded" as paid — would make the product
lie about money, so the lifecycle is explicit and the only path to `PAID` is an authenticated
merchant action.

## Decisions

1. **Three statuses, no more.** `PENDING`, `PAID`, `EXPIRED`. No `CANCELLED` in this milestone
   (product decision): a merchant can simply let an invoice expire. Adding cancellation later needs
   its own transition + audit rules.
2. **Amounts are integer rupiah in `bigint`.** Reuses `parseAmount` and the existing
   `MIN_AMOUNT`/`MAX_AMOUNT` bounds. No floating point anywhere; delivery layer converts to `number`
   only for JSON (max 100,000,000 fits safely).
3. **Expiry is server-enforced but lazy.** Default 60 minutes, allowed 5…10080 minutes
   (`INVOICE_*_TTL_MINUTES`). No Redis/queue: every read/confirm first runs one idempotent
   `UPDATE … WHERE status='PENDING' AND expiresAt <= now()` and appends `EXPIRED` events. `PAID` is
   never touched by the sweep.
4. **Manual confirmation is the only path to `PAID`.** It requires a session cookie, because the
   audit needs a real `confirmed_by_user_id`. API-key requests get `401` on
   `POST /v1/invoices/:id/confirm-payment`; creation/listing are allowed with a key.
   The transition is a single atomic `UPDATE … WHERE status='PENDING' AND expiresAt > now()
   RETURNING id` plus one `PAYMENT_CONFIRMED` event in the same transaction, so a duplicate click or
   a race returns `409 INVOICE_ALREADY_PAID` with no second audit row.
5. **Public identifiers, not sequential numbers.** `INV-` + 12 Crockford-base32 chars from 8 CSPRNG
   bytes (60 bits). URLs use the public id; uuid also accepted. Cross-tenant lookups return `404`,
   never `403`.
6. **QR artifact order: engine → file → row.** The QR is generated and stored before the invoice row
   is inserted, so a failed engine call can never leave a usable-looking invoice; if the insert itself
   fails, the PNG is deleted best-effort (`FileStorage.delete`, new in this milestone). `qrPath` and
   `qrSha256` are stored for audit and re-download.
7. **History is immutable by reference.** `merchantId` and `qrisId` use `ON DELETE RESTRICT`;
   QRIS rows are archived, never deleted, so old invoices keep their provider + display name.
8. **Audit lives in `invoice_events`**, append-only (`CREATED`, `PAYMENT_CONFIRMED`, `EXPIRED`) with
   actor and timestamp, exposed in the detail payload and shown as "Riwayat" in the UI.

## Consequences

- The UI must state plainly that "Dibayar" means *marked by merchant* — it is not provider
  verification. Both the confirmation dialog and the status line say so.
- Reversal of a mistaken confirmation is out of scope: `PAID` is terminal. Correcting it requires a
  future, explicitly designed flow (and an audit entry), not an ad-hoc `PATCH`.
- Expiry granularity is a lazy sweep on read; an invoice can sit `PENDING` past `expiresAt` until the
  next read/confirm. Any consumer must treat `expiresAt` as authoritative, which the API already does.
- No invoice edit endpoint: amount/QRIS are fixed at creation. A wrong invoice means expire + recreate.
