# API — v1

Base URL: `http://localhost:3000` · Swagger: `/docs`

Auth: header `x-api-key: <API_KEY>`. If `API_KEY` is unset the API runs unauthenticated
(local development only, a warning is logged at boot). `/health` is always public.

Errors always use:

```json
{ "success": false, "error": { "code": "UNSUPPORTED_QR_FORMAT", "message": "..." } }
```

| Code | HTTP | Meaning |
|---|---|---|
| `INVALID_FILE_TYPE` | 400 | missing/empty file or not PNG/JPEG |
| `FILE_TOO_LARGE` | 400/413 | exceeds `MAX_UPLOAD_BYTES` |
| `INVALID_AMOUNT` | 400 | not a positive integer in `[MIN_AMOUNT, MAX_AMOUNT]` |
| `QR_NOT_READABLE` | 422 | no decodable QR in the image |
| `UNSUPPORTED_QR_FORMAT` | 422 | readable QR but not a supported QRIS payload |
| `QR_VALIDATION_FAILED` | 422 | QRIS structure invalid or output invariant broken |
| `TRANSFORMATION_FAILED` | 422 | transformer rejected the payload |
| `QR_ENGINE_UNAVAILABLE` | 400 | engine timeout/down |
| `UNAUTHORIZED` | 401 | missing/invalid API key |
| `NOT_FOUND` | 404 | unknown QR job id |
| `INTERNAL_ERROR` | 500 | unexpected failure (details never leaked) |

## GET /health

```json
{ "status": "ok", "service": "kirana-api" }
```

## POST /v1/qr/convert

`multipart/form-data`

| field | type | required | notes |
|---|---|---|---|
| `file` | binary | yes | static QRIS image, PNG/JPEG |
| `amount` | integer | yes | rupiah, e.g. `2300` |
| `note` | string | no | max 25 chars, stored as tag 62/05 |

```bash
curl -X POST http://localhost:3000/v1/qr/convert \
  -H "x-api-key: dev-local-key" \
  -F "file=@qris.png;type=image/png" \
  -F "amount=2300" \
  -F "note=TES KEDUA"
```

```json
{
  "success": true,
  "data": {
    "id": "ea09ebe9-3ec1-4496-9243-669fdefa51b4",
    "status": "generated",
    "amount": 2300,
    "currency": "IDR",
    "merchant": { "nmid": "ID9999999999999", "name": "TOKO CONTOH" },
    "qrImage": { "mimeType": "image/png", "data": "iVBORw0KGgo..." }
  }
}
```

## GET /v1/qr/:id

Returns stored metadata only. `id` must be a UUID.

```json
{
  "success": true,
  "data": {
    "id": "ea09ebe9-3ec1-4496-9243-669fdefa51b4",
    "status": "generated",
    "amount": 2300,
    "currency": "IDR",
    "merchant": { "nmid": "ID9999999999999", "name": "TOKO CONTOH" },
    "createdAt": "2026-10-31T06:47:15.044Z"
  }
}
```

Note: `status` is processing state, never a payment state.
