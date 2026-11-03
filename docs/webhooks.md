# Webhooks (MVP V4)

Kirana Pay mengirim **event** ke endpoint HTTPS milik merchant setiap kali invoice berubah status.
Tidak ada polling: satu event = satu POST, ditandatangani, dengan retry sampai 8 percobaan.

## 1. Event

| Event | Kapan dikirim |
| --- | --- |
| `invoice.created` | invoice dibuat (status `PENDING`) |
| `invoice.paid` | pembayaran dikonfirmasi merchant (status `PAID`) |
| `invoice.expired` | invoice lewat `expiresAt` tanpa pembayaran (status `EXPIRED`) |

Event ditulis ke outbox **di dalam transaksi yang sama** dengan perubahan invoice. Kalau transaksi
rollback, event tidak pernah ada — jadi tidak ada event "hantu" dan tidak ada pembayaran yang lolos
tanpa notifikasi.

## 2. Payload

```json
{
  "id": "evt_k3m9x2q7v5n8b4t6r1w0y2p4za",
  "type": "invoice.paid",
  "createdAt": "2026-11-02T10:05:01.000Z",
  "apiVersion": "2026-11-01",
  "data": {
    "invoice": {
      "reference": "INV-ABC123456789",
      "amount": 25000,
      "currency": "IDR",
      "status": "PAID",
      "createdAt": "2026-11-02T10:00:00.000Z",
      "expiresAt": "2026-11-02T10:15:00.000Z",
      "paidAt": "2026-11-02T10:05:00.000Z"
    }
  }
}
```

`amount` selalu integer rupiah. Tidak ada email, nomor HP, deskripsi, atau id internal di payload.

## 3. Header

| Header | Isi |
| --- | --- |
| `Content-Type` | `application/json` |
| `User-Agent` | `KiranaPay-Webhooks/1` |
| `Kirana-Event-Id` | sama dengan `id` di body (pakai ini untuk dedupe) |
| `Kirana-Timestamp` | detik Unix saat request dibuat |
| `Kirana-Signature` | `v1=<hex hmac-sha256>` |

## 4. Verifikasi signature

String yang ditandatangani: `"{timestamp}.{raw body}"`, HMAC-SHA256 dengan **signing secret**
(`whsec_…`, hanya ditampilkan sekali saat endpoint dibuat / secret dirotasi).

Aturan wajib di sisi penerima:

1. Hitung ulang HMAC dari **raw body** (jangan `JSON.parse` lalu `JSON.stringify` ulang).
2. Bandingkan dengan `crypto.timingSafeEqual` / `hash_equals`.
3. Tolak kalau `|now - timestamp| > 300` detik (anti-replay).
4. Balas `2xx` dalam **5 detik**. Kerja berat → antre dulu, balas cepat.

```ts
// Node
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verify(rawBody: string, signature: string, timestamp: string, secret: string) {
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest();
  const given = Buffer.from(signature.replace(/^v1=/, ''), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
```

```python
# Python
import hmac, hashlib, time

def verify(raw_body: bytes, signature: str, timestamp: str, secret: str) -> bool:
    if abs(time.time() - int(timestamp)) > 300:
        return False
    expected = hmac.new(secret.encode(), f"{timestamp}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature.removeprefix("v1="))
```

```php
// PHP
$expected = hash_hmac('sha256', $timestamp . '.' . $rawBody, $secret);
$ok = abs(time() - (int) $timestamp) <= 300
    && hash_equals($expected, substr($signature, 3)); // strip "v1="
```

## 5. Retry

| Percobaan | Jeda |
| --- | --- |
| 1 | langsung |
| 2 | 30 detik |
| 3 | 2 menit |
| 4 | 10 menit |
| 5 | 30 menit |
| 6 | 1 jam |
| 7 | 3 jam |
| 8 | 6 jam |

- Jitter ±20%, `Retry-After` dihormati (dibatasi 1 jam).
- Retry berhenti setelah 8 percobaan atau 24 jam sejak event dibuat.
- Timeout: 5 detik total, 3 detik connect. Redirect **tidak** diikuti (3xx = gagal permanen).
- `4xx` selain `408`, `425`, `429` = gagal permanen (tidak di-retry). `5xx`/timeout/DNS = retry.
- Delivery bisa di-retry manual sekali lewat dashboard/API (event < 7 hari).
- Simpan `X-Kirana-Event-Id`; kiriman ganda mungkin terjadi (at-least-once) → **wajib idempotent**.

## 6. Mengelola endpoint

Butuh sesi dashboard (cookie). API key developer **tidak bisa** mengelola webhook.

```bash
# daftar
GET    /v1/webhook-endpoints

# daftar endpoint baru → response berisi `secret` SATU KALI
POST   /v1/webhook-endpoints
{ "url": "https://contoh.com/kirana/webhook", "events": ["invoice.paid"], "description": "Toko A" }

# detail / ubah / arsip
GET    /v1/webhook-endpoints/:id
PATCH  /v1/webhook-endpoints/:id   { "status": "DISABLED" }
DELETE /v1/webhook-endpoints/:id

# rotasi secret (langsung berlaku; update server penerima dulu)
POST   /v1/webhook-endpoints/:id/rotate-secret

# riwayat + retry manual
GET    /v1/webhook-endpoints/:id/deliveries?limit=20
POST   /v1/webhook-deliveries/:id/retry
```

Batas: 5 endpoint aktif per merchant, maksimal 2048 karakter URL, hanya `https`
(`http` hanya kalau `WEBHOOK_DEV_ALLOW_PRIVATE=true` untuk development).

## 7. Keamanan

- URL divalidasi saat didaftarkan **dan** di-resolve ulang saat pengiriman: IP privat/loopback/
  link-local/metadata (`169.254.169.254`) ditolak, jadi tidak bisa dipakai SSRF ke jaringan internal.
- Port dibatasi `443,8443` (default).
- Signing secret disimpan terenkripsi AES-256-GCM (`WEBHOOK_SECRET_ENCRYPTION_KEY`), tidak pernah
  dikembalikan lewat API setelah dibuat.
- Setiap perubahan endpoint (dibuat, URL berubah, secret dirotasi, dinonaktifkan) dicatat di audit log.
- Retensi riwayat delivery: 30 hari.

## 8. Uji lokal

```bash
# terminal 1: penerima
python3 -m http.server 9000

# .env
WEBHOOK_DEV_ALLOW_PRIVATE=true

# lalu daftarkan endpoint http://127.0.0.1:9000/hook (hanya jalan di non-production)
```

Worker berjalan di proses API (`WEBHOOK_WORKER_ENABLED=true`). Log: `Webhook worker started`.
