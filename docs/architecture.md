# Architecture — MVP 0.1

```text
client ──multipart──▶ apps/api (NestJS) ──HTTP/internal──▶ services/qr-engine (Rust)
                            │                                     │
                            ├── PostgreSQL (qr_jobs)               ├── image decode (rqrr)
                            └── local file storage (var/qr)        ├── validate (EMVCo/QRIS structure)
                                                                   ├── transform (Python parity)
                                                                   └── generate (qrcode)
```

## Request flow

1. `POST /v1/qr/convert` (multipart: `file`, `amount`, optional `note`).
2. API validates: size limit, magic-byte image type (PNG/JPEG), integer amount in range.
3. API sends `{ imageBase64, amount, note }` to `POST /internal/qr/convert` with a timeout.
4. Engine decodes the QR (`rqrr`), validates the EMVCo/QRIS structure, transforms it, and
   renders a PNG.
5. API stores metadata (`qr_jobs`), writes the PNG through the `FileStorage` abstraction,
   and returns the base64 image plus metadata.
6. `GET /v1/qr/:id` returns stored metadata only — never a payment status.

## Transformation rules (ported from the proven Python implementation)

- tag `01` → `12` (point of initiation: dynamic)
- tag `54` → `"{amount}.00"` (transaction amount, IDR)
- optional `note` → subtag `05` inside tag `62`, **merged** so existing subtags (notably
  `07` terminal label) survive
- fields emitted in ascending tag order, tag `63` recomputed with CRC16-CCITT/XModem
  (init `0xFFFF`, poly `0x1021`) over the payload + `"6304"`

Everything else in the payload is passed through untouched.

## What is validated

Only verifiable structure: payload format indicator `00 = 01`, currency `53 = 360`,
country `58 = ID`, merchant name `59`, QRIS national block `51` with
`00 = ID.CO.QRIS.WWW` and an `ID…` NMID in `02`, and at least one merchant account template
in the 26–45 range. Anything else is rejected rather than guessed.

## Deliberate non-goals

No payment verification, no wallet/escrow, no webhook, no dashboard, no notification
listener, no provider integration. Adding those requires a separate design.

## Truth about validity

A generated QR that decodes and carries a valid CRC is **structurally** valid. Whether an
acquirer accepts it depends on the merchant account state and the payer app. Always verify
with the relevant payment application before claiming a transaction works.
