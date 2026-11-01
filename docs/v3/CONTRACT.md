# MVP V3 — Kontrak API Payment Link (DIBEKUKAN)

Hanya Agent A yang boleh mengubah file ini. Agent B membangun terhadapnya. Envelope dan error mengikuti
`docs/api.md`: sukses `{ "success": true, "data": … }`, gagal `{ "success": false, "error": { "code", "message" } }`.

Catatan klien: helper `api()` di `apps/web/lib/api.ts` mengembalikan `body.data ?? body`. Karena itu semua
`data` di bawah adalah **objek** (tidak pernah `null` langsung), supaya aman dengan helper itu.

## A. Endpoint merchant (wajib session cookie; API key ditolak 401)

`:id` = `publicId` invoice (`INV-…`) atau UUID. Invoice milik merchant lain → `404 NOT_FOUND`.

### POST `/v1/invoices/:id/payment-link`
Buat atau ambil link aktif (idempoten). Tanpa body.

- `201` link baru dibuat, `200` link aktif sudah ada.
- `data`: `{ "created": boolean, "link": PaymentLinkView }`
- Error: `401 UNAUTHORIZED`, `404 NOT_FOUND`, `409 INVOICE_ALREADY_PAID`, `410 INVOICE_EXPIRED`,
  `429`, `503 PAYMENT_LINK_NOT_CONFIGURED`.

### GET `/v1/invoices/:id/payment-link`
Link terbaru (aktif; kalau tidak ada yang aktif, yang terakhir dicabut). Tidak pernah error karena "belum ada".

- `data`: `{ "link": PaymentLinkView | null }` (`null` = belum pernah dibuat)
- Error: `401`, `404 NOT_FOUND` (invoice), `503 PAYMENT_LINK_NOT_CONFIGURED` hanya jika link ACTIVE perlu URL tapi konfigurasi hilang.

### DELETE `/v1/invoices/:id/payment-link`
Cabut link aktif. Permanen: token lama tidak pernah valid lagi. Boleh untuk invoice PAID/EXPIRED.

- `data`: `{ "link": PaymentLinkView }` (status `REVOKED`, `url: null`)
- Error: `401`, `404 NOT_FOUND` (invoice), `404 PAYMENT_LINK_NOT_FOUND` (tidak ada link aktif).

### `PaymentLinkView`
```json
{
  "status": "ACTIVE | REVOKED",
  "url": "https://host/pay/<token>  (null jika REVOKED)",
  "createdAt": "ISO-8601",
  "createdBy": { "email": "…" } ,
  "revokedAt": "ISO-8601 | null",
  "revokedBy": { "email": "…" }
}
```
`createdBy`/`revokedBy` bernilai `null` bila tidak ada atau pengguna sudah dihapus. Token mentah hanya ada di dalam `url`.
Tidak ada ID internal maupun hash.

## B. Endpoint publik (tanpa login)

### GET `/v1/public/payment-links/:token`
Read-only. Tidak pernah mengubah invoice. Header respons: `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`.
Rate limit 60 permintaan/menit/IP.

- `200`, `data`: `PublicPaymentView`
- `404 PAYMENT_LINK_UNAVAILABLE`: token salah bentuk, tidak dikenal, link dicabut, atau status invoice tak dikenal.
  **Sengaja identik** untuk semuanya; UI menampilkan satu pesan generik ("tidak tersedia atau sudah dinonaktifkan").
- `429`: terlalu banyak permintaan.
- `503 PAYMENT_LINK_QR_UNAVAILABLE`: invoice masih bisa dibayar tetapi QR tidak bisa dibaca saat ini (coba lagi nanti).

### `PublicPaymentView`
```json
{
  "state": "PAYABLE | PAID | EXPIRED",
  "merchantName": "Toko Utama",
  "invoice": {
    "reference": "INV-ABCDEFGHJKMN",
    "description": "string | null",
    "amount": 2300,
    "currency": "IDR",
    "createdAt": "ISO-8601",
    "expiresAt": "ISO-8601",
    "paidAt": "ISO-8601 | null"
  },
  "qrImageDataUrl": "data:image/png;base64,… | null",
  "serverTime": "ISO-8601"
}
```

Aturan tampilan yang dijamin server:
- `qrImageDataUrl` **hanya** terisi saat `state = PAYABLE`. Selain itu selalu `null`.
- `PAYABLE`: link aktif, invoice `PENDING`, dan belum lewat `expiresAt` menurut jam server/DB.
- `PAID`: invoice sudah ditandai lunas oleh merchant (konfirmasi manual). Ini **bukan** verifikasi provider.
- `EXPIRED`: invoice `EXPIRED`, atau `PENDING` yang sudah lewat `expiresAt`.
- `description` adalah teks mentah dari merchant. **Frontend wajib menampilkannya sebagai teks (escape)**, jangan `dangerouslySetInnerHTML`.
- `serverTime` dipakai untuk menghitung sisa waktu tanpa mempercayai jam browser (`offset = serverTime - Date.now()` saat fetch).
- Field lain (email/telepon merchant, ID internal, ID QRIS, provider, confirmer) **tidak pernah** dikirim.

## C. Bentuk token dan URL

URL: `${PUBLIC_BASE_URL}/pay/<token>`; token 44 karakter `[A-Za-z0-9_-]`. Halaman Next.js berada di route `/pay/[token]`.
Token diperlakukan sebagai rahasia: jangan di-log, jangan dikirim ke analytics, jangan ditaruh di query string.
