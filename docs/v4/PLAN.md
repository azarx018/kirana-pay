# MVP V4 — Developer API & Webhook: audit (Stage 0) dan rencana (Stage 1)

Status: **MENUNGGU PERSETUJUAN** (bagian 9). Belum ada kode V4.
Branch: `feat/mvp-v4-developer-api-webhook`, bertumpu pada `feat/mvp-v3-payment-link` (V3 belum di-merge).
Spec sumber: `kirana_pay_mvp_v4_developer_api_webhook_prompt.md`.

## 1. Audit V1–V3 (fakta terverifikasi dari kode)

| Area | Temuan |
|---|---|
| Prasyarat | V1 dan V2 lengkap. V3 **backend** selesai (commit `8efee8a`), **frontend V3 (Agent B) belum dimulai**: `git status` tidak menunjukkan perubahan `apps/web`. V4 backend tidak bergantung pada UI V3. |
| Runtime | Node v22.22.2, NestJS 11, TypeORM 0.3, `@nestjs/throttler` 6.7.1 (mendukung `getTracker`/`generateKey` per throttler), PostgreSQL 16. Tidak ada `@nestjs/schedule`, queue, worker, atau outbox. Tidak ada `undici`/`ipaddr.js`. |
| API key (V1) | `entities/api-key.entity.ts`: `merchantId, name, prefix (14 char), keyHash (SHA-256 unik), lastUsedAt, revokedAt, createdAt`. Format `kp_live_<48 hex>` (192 bit acak). **Tidak ada**: scope, expiry, pembuat, riwayat rotasi. Header hanya `x-api-key` (tidak ada `Authorization: Bearer`). |
| Guard | `ApiKeyOrSessionGuard`: lookup by hash, tolak revoked. API key diperlakukan `role: OWNER`, `userId: ''`. `lastUsedAt` di-UPDATE **pada setiap request** (fire-and-forget). |
| Kelola key | `GET/POST/DELETE /v1/api-keys`, `POST /v1/api-keys/:id/rotate`: session + owner saja. **Rotate tidak atomik** (revoke lalu create, dua save terpisah). Tanpa grace period (sesuai spec). |
| Route yang sudah menerima API key | `POST/GET /v1/invoices`, `GET /v1/invoices/:id`, `GET /v1/invoices/:id/qr`, `/v1/qr/*`. `confirm-payment` **session only** (diverifikasi e2e). Payment link V3 session only. Jadi "Developer API" sebagian sudah ada tapi tanpa scope/idempotency. |
| View invoice | `InvoiceView` berisi `id` (UUID internal), `qris.id`, `confirmedBy.email`, `confirmationMethod`, `qrUrl`: view dashboard, **bukan kontrak publik stabil**. |
| Transisi status | `create`: satu transaksi (invoice + event `CREATED`). `confirmPayment`: satu transaksi atomik, UPDATE bersyarat, idempoten, session saja. **`sweepExpired`: UPDATE lalu insert event TANPA transaksi** (crash di antaranya menghilangkan event EXPIRED). |
| Expiry | Hanya lazy (ADR 0001): invoice tetap `PENDING` di DB melewati `expiresAt` sampai merchant membaca/konfirmasi. Tidak ada scheduler. |
| Status | `PENDING, PAID, EXPIRED` (CHECK DB). **`CANCELLED` tidak ada** (ADR 0001). |
| Paginasi | `GET /v1/invoices`: `limit` 1..50, cursor = `createdAt` ISO (ms) dengan `createdAt < before`. **Rawan lompat/duplikat** saat `createdAt` kembar (DB µs vs JS ms). Index `(merchantId, createdAt DESC)` dan `(merchantId, status, createdAt DESC)` sudah ada. |
| Error | `AllExceptionsFilter`: `{success:false,error:{code,message}}`. Semua 401 dipaksa `UNAUTHORIZED`; validasi → `BAD_REQUEST`; 429 → `TOO_MANY_REQUESTS`; 404 → `NOT_FOUND`. **Kode di spec (`INVALID_API_KEY`, `VALIDATION_ERROR`, …) berbeda dari konvensi repo.** |
| Validasi | `ValidationPipe({whitelist:true, transform:true})`: field tak dikenal (`status`, `merchantId`, `paidAt`) **dibuang diam-diam**, tidak pernah dipakai. Body JSON memakai default Express (100 kb); tidak ada pengecekan content-type eksplisit. |
| Rate limit | Throttler global 120/mnt **per IP**; override per route (invoice create 30/mnt). Tidak ada limit per API key. |
| Egress HTTP | Satu-satunya: `QrEngineClient` (fetch ke URL internal tetap). Tidak ada validasi URL/SSRF. Compose: API sejajar dengan `postgres` dan `qr-engine` di jaringan internal; deploy lewat Tailscale (rentang 100.64.0.0/10 harus diblokir). |
| Logging/Config | Nest `Logger` saja, tanpa request id/metrics. Rahasia lewat env (`assertProductionConfig`, pola `PAYMENT_LINK_SECRET` V3). Swagger hanya bila `ENABLE_SWAGGER=true`. |
| Dashboard | `apps/web/components/SettingsTab.tsx` mengelola API key (list/buat/cabut); snippet masih `x-api-key`. Tidak ada UI webhook. |
| Tes | Jest unit (85 lulus di branch V3) + `scripts/e2e.sh` (stack nyata). Tidak ada integration test jest berbasis DB. |
| Dokumentasi usang | `docs/api.md` Authentication masih menulis "hanya `/v1/qr/*` menerima API key" (sudah tidak benar sejak V2). `src/data-source.ts` tidak mendaftarkan entity/migration invoice dan payment link. |

Blocker keras: **tidak ada**. SSRF aman bisa ditegakkan di runtime ini (bagian 6). Risiko yang harus diketahui: lihat bagian 8.

## 2. Keputusan desain (rekomendasi, butuh persetujuan di bagian 9)

### 2.1 Permukaan API
Route baru **`/v1/developer/*`** dengan DTO respons publik stabil (camelCase, konsisten dengan repo), memakai service V2/V3 yang ada:
`POST/GET /v1/developer/invoices`, `GET /v1/developer/invoices/:reference`, `POST/GET /v1/developer/invoices/:reference/payment-link`.
Route lama `/v1/invoices*` untuk API key **tidak diubah bentuknya** (kompatibilitas V1–V3), hanya mendapat pengecekan scope.
Alasan: kontrak developer + payload webhook memakai satu mapper stabil dan tidak ikut berubah bila dashboard berevolusi.
Public view: `reference` (= `publicId`), `amount`, `currency`, `description`, `status`, `createdAt`, `expiresAt`, `paidAt`, `paymentLink` (opsional). Tanpa UUID internal, QRIS id, email, confirmationMethod.
`qrisId` input tetap UUID QRIS merchant (disalin dari dashboard); tidak ada endpoint list QRIS baru (di luar scope).

### 2.2 Auth dan scope
- Terima `Authorization: Bearer <key>` **dan** `x-api-key` (kompatibel). Tidak pernah dari query string. Dua-duanya sekaligus dengan nilai berbeda → 401.
- Scope: `invoices:read`, `invoices:write`, `payment_links:read`, `payment_links:write`, dan `qr:convert` (ditambahkan khusus agar key lama yang memakai `/v1/qr/convert` tidak patah). **Tidak ada scope untuk menandai lunas.**
- Migrasi: key lama di-backfill `invoices:read, invoices:write, qr:convert` (persis kemampuan mereka hari ini, tanpa eskalasi). Key baru **wajib** menyebut scope eksplisit (dashboard pre-select `invoices:*`).
- Kolom baru `api_keys`: `scopes text[]`, `expiresAt`, `createdByUserId`, `revokedByUserId`, `rotatedFromId`. Rotate jadi **satu transaksi**, mewarisi scope+expiry, key lama langsung mati, tanpa grace.
- `ScopeGuard` + `@RequireScopes(...)` berjalan setelah autentikasi dan sebelum logika bisnis; session (dashboard) tidak terkena scope. 403 `INSUFFICIENT_SCOPE`.
- `lastUsedAt` hanya di-update bila lebih tua dari 5 menit (UPDATE bersyarat), menghilangkan write per request.
- Rate limit per key: throttler kedua bernama `apikey` (tracker = hash key, tanpa DB) **ditambah** throttler IP yang tetap berlaku (agar tebak-tebak key acak tidak lolos dari limit IP). Default 120/mnt baca, 30/mnt create invoice. Bentuk 429: kode `RATE_LIMITED`.
- Body JSON dibatasi 32 kb, `Content-Type: application/json` wajib di `/v1/developer` (415 `UNSUPPORTED_MEDIA_TYPE`).
- Kode error: **pertahankan konvensi repo** (`UNAUTHORIZED`, `NOT_FOUND`, `BAD_REQUEST`, `INTERNAL_ERROR`), tambah `INSUFFICIENT_SCOPE`, `IDEMPOTENCY_CONFLICT`, `IDEMPOTENCY_IN_PROGRESS`, `RATE_LIMITED`. Tidak mengganti nama kode yang sudah ada.

### 2.3 Paginasi
Developer list: keyset `(createdAt, id)` dengan cursor opaque (base64url), `limit` 1..50 (default 20), filter `status`, `createdBefore/After` divalidasi, selalu `merchantId`-scoped, memakai index yang ada. Route lama tidak diubah.

### 2.4 Idempotency (`Idempotency-Key`, hanya `POST /v1/developer/invoices`)
Tabel `idempotency_records(merchantId, operation, keyHash=sha256(key), fingerprint=sha256(body ternormalisasi), state IN_PROGRESS|COMPLETED, invoiceId, createdAt, expiresAt)`, unique `(merchantId, operation, keyHash)`.
1. `INSERT … ON CONFLICT DO NOTHING`: menang = lanjut membuat invoice, lalu tandai `COMPLETED` + `invoiceId`.
2. Key sama + fingerprint beda → `409 IDEMPOTENCY_CONFLICT`.
3. Key sama + `COMPLETED` → kembalikan invoice asli (status **terkini**, bukan snapshot beku; didokumentasikan).
4. Key sama + `IN_PROGRESS` (paralel) → `409 IDEMPOTENCY_IN_PROGRESS` + `Retry-After`. `IN_PROGRESS` lebih tua dari 2 menit dianggap ditinggalkan dan bisa diambil alih.
5. Gagal (validasi/engine) → record dihapus agar klien bisa mencoba lagi dengan key sama.
Format key 8–128 karakter `[A-Za-z0-9_.:-]`. Retensi 24 jam (dibersihkan worker). Route lama `/v1/invoices` mengabaikan header ini (didokumentasikan; bukan header dekoratif di route yang memang mendukungnya).

### 2.5 Katalog event dan payload
Event yang **benar-benar ada**: `invoice.created`, `invoice.paid`, `invoice.expired`.
**`invoice.cancelled` TIDAK diimplementasi** (tidak ada status `CANCELLED`, ADR 0001).
Envelope (camelCase, `apiVersion` tetap `2026-11-02`):
```json
{ "id": "evt_<26 char base32>", "type": "invoice.paid", "createdAt": "ISO-8601", "apiVersion": "2026-11-02",
  "data": { "invoice": { "reference": "INV-…", "amount": 25000, "currency": "IDR", "status": "PAID",
                         "createdAt": "…", "expiresAt": "…", "paidAt": "…" } } }
```
Tanpa `description` (bisa berisi data pelanggan), tanpa ID internal/QRIS/email. Merchant mengambil detail lewat API.
Pemicu: `created` di transaksi `InvoicesService.create`; `paid` di transaksi `confirmPayment` (satu-satunya jalur ke PAID, session + konfirmasi manual); `expired` di transaksi sweep. Insert outbox ada **di dalam transaksi yang sama**; rollback = tanpa event. UPDATE bersyarat yang tidak mengubah baris (ulangan idempoten) tidak menerbitkan event.

### 2.6 Outbox dan worker (tanpa dependency baru)
Tabel: `webhook_events` (outbox: `eventId` unik, `merchantId`, `type`, `invoiceId`, `payloadJson text` = byte persis yang dikirim di setiap percobaan), `webhook_deliveries` (per event × endpoint: `status PENDING|IN_FLIGHT|SUCCEEDED|FAILED|CANCELLED`, `attemptCount`, `nextAttemptAt`, `lockedUntil`), `webhook_delivery_attempts` (riwayat), `webhook_endpoints`, `webhook_endpoint_audit`.
Worker berjalan di proses API (`WEBHOOK_WORKER_ENABLED`, default true), loop `setTimeout`:
1. **Fan-out**: klaim event dengan `FOR UPDATE SKIP LOCKED` (lease `lockedUntil`), buat delivery untuk endpoint aktif yang subscribe tipe itu (unik `(eventRowId, endpointId)`), tandai event terproses.
2. **Kirim**: klaim delivery jatuh tempo (`SKIP LOCKED` + lease), **lepas lock sebelum HTTP**, kirim, tulis attempt + status via UPDATE bersyarat atas lease. Lease kedaluwarsa = otomatis diklaim ulang (pemulihan crash/restart).
3. Sweep expiry berkala dan pembersihan retensi.
Aman multi-instance (SKIP LOCKED). Shutdown halus: berhenti klaim, menunggu in-flight (maks timeout request). Konfigurasi: `WEBHOOK_WORKER_CONCURRENCY` (4), `WEBHOOK_POLL_INTERVAL_MS` (2000).
Endpoint dinonaktifkan/diarsip → delivery PENDING-nya `CANCELLED (ENDPOINT_DISABLED)`. Pengiriman memakai **konfigurasi endpoint terkini** (URL/secret/aktif) dan validasi SSRF diulang setiap kali; riwayat menyimpan host saja.

### 2.7 Expiry sweeper (mengubah perilaku V2: lihat keputusan K3)
Tanpa sweeper, `invoice.expired` hanya terbit saat merchant kebetulan membaca invoice. Rencana: sweep batch (≤200, `SKIP LOCKED`) tiap 30 dtk di worker, plus `sweepExpired` lama dibungkus **transaksi** yang sama (UPDATE + event invoice + outbox). Semantik status tidak berubah; hanya DB menjadi `EXPIRED` lebih cepat dan atomik.

### 2.8 Retry dan pengiriman
- 2xx = sukses. Retryable: error jaringan, timeout, 408, 425, 429, 500, 502, 503, 504. Terminal: 4xx lain, 3xx (**redirect tidak diikuti**, `REDIRECT_NOT_FOLLOWED`).
- Backoff: 30s, 2m, 10m, 30m, 1j, 3j, 6j (±20% jitter), maks 8 percobaan **dan** umur 24 jam (`WEBHOOK_MAX_ATTEMPTS`, `WEBHOOK_MAX_AGE_HOURS`). `Retry-After` (429/503) dihormati, dijepit antara backoff dan 1 jam.
- Timeout: connect 5 dtk, total 10 dtk. Respons dibaca maks 2 KB, excerpt tersimpan ≤256 karakter, dibersihkan dari karakter kontrol.
- **Retry manual** (hanya delivery `FAILED`, event ≤7 hari, session owner): satu attempt tambahan segera untuk **event ID yang sama**; jika gagal kembali `FAILED` tanpa jadwal otomatis.
- Retensi riwayat: 30 hari. Jaminan: **at-least-once**, bukan exactly-once.

### 2.9 Penandatanganan
Header (dibuat ulang tiap percobaan): `Kirana-Event-Id`, `Kirana-Timestamp` (detik unix), `Kirana-Signature: v1=<hex>`; `Content-Type: application/json`; `User-Agent: KiranaPay-Webhooks/1`. Tidak ada header buatan merchant.
`signature = HMAC-SHA256(secret, "<timestamp>.<rawBody>")` atas **byte persis** `payloadJson`. Penerima: bandingkan timing-safe, toleransi ±5 menit, **dedupe by event ID** (timestamp saja tidak mencegah replay). Contoh verifikasi Node/TypeScript ada di docs.
Secret endpoint `whsec_<43 base64url>`, tampil sekali (buat/rotate). Karena HMAC butuh nilai aslinya, disimpan **terenkripsi AES-256-GCM** (`node:crypto`) dengan `WEBHOOK_SECRET_ENCRYPTION_KEY` (32 byte, base64; wajib di production, jika tidak fitur webhook membalas 503 tanpa memblokir boot). Format tersimpan berversi `v1:…`. Rotasi secret langsung berlaku (tanpa overlap); retry berikutnya ditandatangani secret baru. Secret tidak pernah ada di respons list/detail, log, URL, atau payload.

### 2.10 Manajemen endpoint (session; mutasi owner-only)
`POST/GET /v1/webhook-endpoints`, `GET/PATCH/DELETE /v1/webhook-endpoints/:id` (DELETE = arsip, riwayat tetap, ciphertext secret dihapus), `POST …/:id/rotate-secret`, `GET …/:id/deliveries` (cursor), `POST /v1/webhook-deliveries/:id/retry`. Maks 5 endpoint aktif per merchant (`WEBHOOK_MAX_ENDPOINTS`). Audit di `webhook_endpoint_audit` (dibuat, URL diubah, event diubah, aktif/nonaktif, rotate, arsip; hanya host, tidak pernah secret). Tanpa endpoint "kirim tes" (di luar spec).

## 3. Desain SSRF (blocker rilis; hanya `node:https`/`node:dns`/`node:net`)
1. **Validasi URL saat disimpan dan setiap pengiriman**: skema `https` saja, tanpa username/password/fragment, panjang ≤2048, host berupa **nama DNS** (IP literal ditolak), tolak `localhost`, `*.localhost`, `*.local`, `*.internal`, host satu-label (mis. `postgres`, `qr-engine`), port hanya `WEBHOOK_ALLOWED_PORTS` (default 443, 8443).
2. **Validasi di waktu koneksi**: request memakai `lookup` kustom → `dns.lookup(all:true)`; **semua** alamat hasil harus publik, jika ada satu saja yang tidak publik → ditolak. Koneksi dipaku ke IP tervalidasi itu (tidak ada resolusi kedua → tidak ada TOCTOU/DNS rebinding). TLS: `servername` = hostname, `rejectUnauthorized: true`. Pertahanan berlapis: setelah connect, `socket.remoteAddress` dicek ulang.
3. **Daftar blokir** (`net.BlockList`): IPv4 `0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.0.0/24, 192.0.2/24, 192.168/16, 198.18/15, 198.51.100/24, 203.0.113/24, 224/4, 240/4`; IPv6 `::, ::1, fc00::/7, fe80::/10, ff00::/8, 2001:db8::/32, 100::/64`, plus IPv4-mapped/NAT64/6to4 diperiksa lewat IPv4 yang ditanam.
4. Redirect tidak pernah diikuti; tanpa proxy env; tanpa header merchant; respons dibatasi ukuran; bukan proxy URL generik (URL hanya dari endpoint terdaftar).
5. **Kebijakan dev terisolasi**: `WEBHOOK_DEV_ALLOW_PRIVATE=true` hanya berlaku bila `NODE_ENV!=production`; di production boot **ditolak** bila variabel ini set. Dipakai khusus e2e lokal.
6. Batasan: perlindungan ada di level aplikasi; disarankan egress firewall host/container sebagai lapis kedua (didokumentasikan).

## 4. Migrasi
`1700000003000-DeveloperApiKeys` (kolom baru `api_keys` + backfill scope), `1700000004000-Idempotency`, `1700000005000-Webhooks` (endpoints, audit, events, deliveries, attempts). Semua `IF NOT EXISTS`, FK `ON DELETE RESTRICT`/`SET NULL` (tanpa cascade destruktif), CHECK untuk status, index merchant-scoped dan index klaim worker `(status, nextAttemptAt)`.

## 5. Pembagian kerja
Agent A (ini): Stage 2–5 dan 7 (`apps/api/**`, `docs/**`, `scripts/`, compose/env).
Agent B: **Stage 6 frontend saja** (`apps/web/**`) setelah kontrak dibekukan di `docs/v4/CONTRACT.md`: UI scope+kedaluwarsa key, area Webhook (endpoint, riwayat, retry), tautan docs. Frontend paling akhir sesuai arahan pemilik.

## 6. Daftar file (perkiraan)
Baru: `api-keys/` (scope, guard, DTO), `developer/` (controller, mapper), `idempotency/`, `webhooks/` (domain, outbox, worker, sender, ssrf, signer, crypto, controllers), 3 migrasi, entity baru, spec, `docs/v4/*`, `docs/developer/*`.
Ubah: `invoices.service.ts` (insert outbox di transaksi + transaksi sweep), `api-key.guard.ts`, `api-keys.*`, `app.module.ts`, `main.ts` (body limit), `common/runtime-config.ts`, `all-exceptions.filter.ts` (hanya kode 403/429), `scripts/e2e.sh`, compose/env, `docs/api.md`, `AGENTS.md`.

## 7. Matriks tes
Unit (jest): scope guard, key hash/Bearer parsing, idempotency fingerprint/state machine, signer (HMAC byte persis, timestamp), AES-GCM roundtrip/tamper, SSRF (URL + semua rentang IP + IPv6 mapped), backoff/Retry-After, klasifikasi hasil.
E2E (stack nyata + penerima lokal dev-policy): key valid/invalid/revoked/expired/scope, merchant lain, tidak bisa set PAID, paginasi, idempotensi (duplikat, konflik, paralel), event hanya setelah commit, `paid` hanya via konfirmasi, payload+ID stabil antar retry, restart worker memulihkan, dua worker tidak memproses delivery yang sama, kegagalan webhook tidak mengubah invoice, retry manual ID sama, endpoint nonaktif, isolasi tenant, SSRF diblokir (tanpa dev-policy), tidak ada secret di log, regresi V1–V3.

## 8. Risiko dan hal yang harus diketahui
1. Perubahan ke kode V2: insert outbox di transaksi `create`/`confirmPayment` (tanpa ubah semantik) dan transaksi `sweepExpired` (memperbaiki celah atomisitas yang sudah ada).
2. Sweeper mengubah "expiry lazy" (ADR 0001) menjadi eksplisit di DB; perlu persetujuan.
3. Env wajib baru di production: `WEBHOOK_SECRET_ENCRYPTION_KEY`. Hilang/ganti kunci = semua secret endpoint tak terbaca (harus di-rotate).
4. Tanpa egress firewall, SSRF hanya dijaga lapis aplikasi.
5. Worker di proses API: bila API di-scale >1, aman (SKIP LOCKED), tapi `WEBHOOK_WORKER_ENABLED` bisa dimatikan di instance tertentu.
6. Tidak ada sandbox/test mode; tidak akan diklaim.

## 9. Keputusan yang perlu persetujuan pemilik (default = rekomendasi di atas)
- **K1** Route baru `/v1/developer/*` dengan DTO publik stabil, route lama tidak diubah bentuknya.
- **K2** Backfill scope key lama (`invoices:*`, `qr:convert`) dan scope eksplisit wajib untuk key baru; tambah `Authorization: Bearer`.
- **K3** Sweeper expiry di worker + transaksi atomik pada `sweepExpired` (menyentuh V2).
- **K4** Secret webhook disimpan terenkripsi AES-256-GCM dengan env baru; rotasi tanpa overlap.
- **K5** Casing camelCase untuk API dan payload webhook (spec memberi contoh snake_case).
- **K6** Retensi: idempotency 24 jam, riwayat webhook 30 hari; retry manual hanya untuk delivery `FAILED` ≤7 hari.
- **K7** `invoice.cancelled` tidak diimplementasi (tidak ada status).

---

## STATUS — Stage 4 (webhooks) selesai

Diimplementasikan di branch `feat/mvp-v4-webhooks` (lanjutan dari `2c2117a`):

- **Entity**: `webhook_endpoints`, `webhook_endpoint_audit`, `webhook_events` (outbox),
  `webhook_deliveries`, `webhook_delivery_attempts` — sesuai migrasi `1700000005000-Webhooks`.
- **Outbox transaksional**: `WebhookEventsService.enqueue()` dipanggil di dalam transaksi
  `InvoicesService.create()`, `confirmPayment()`, `sweepExpired()` → commit = event ada.
- **Fan-out + delivery worker**: `WebhookWorkerService` (poll 2s, `FOR UPDATE SKIP LOCKED`,
  lease 2 menit, retry 30s→6j dengan jitter, `Retry-After` dihormati, max 8 attempt / 24 jam).
- **Sender SSRF-safe**: DNS di-resolve saat koneksi dan di-pin, IP privat/loopback/link-local
  ditolak, port allowlist, redirect tidak diikuti, timeout 5s/3s connect, body respons dibatasi 2KB.
- **API dashboard**: CRUD endpoint (sesi saja, bukan API key), rotasi secret, riwayat delivery,
  retry manual. Secret dienkripsi AES-256-GCM dan hanya dikembalikan sekali.
- **Expiry**: sweep global tiap siklus worker (200 baris/batch) + sweep lazy per merchant, keduanya
  atomik dengan event outbox.
- **Retensi**: 30 hari untuk event/delivery/attempt.
- **Docs**: `docs/webhooks.md` (event, signature, retry, contoh verifikasi Node/Python/PHP).
- **Env**: `WEBHOOK_SECRET_ENCRYPTION_KEY` (wajib di produksi), `WEBHOOK_WORKER_ENABLED`,
  `WEBHOOK_MAX_ENDPOINTS`, `WEBHOOK_ALLOWED_PORTS`, `WEBHOOK_DEV_ALLOW_PRIVATE`.

Verifikasi: `tsc --noEmit` bersih, jest **360 test / 31 suite** lulus, plus E2E nyata terhadap
Postgres + penerima lokal (bukan mock):

- `invoice.paid` → fan-out → POST ke penerima → **200 dalam 8 ms**, signature `v1=` valid
  (diverifikasi ulang oleh penerima dengan HMAC), delivery `SUCCEEDED`.
- Penerima balas **500** → `RETRYABLE`, status kembali `PENDING`, `attemptCount=1`,
  `nextAttemptAt` +30 detik (backoff jalan).
- URL privat (`http://127.0.0.1`, `https://localhost`, `https://169.254.169.254`, `https://10.0.0.5`)
  dan port non-allowlist ditolak validator; `https://example.com` diterima.
- Constraint `(merchantId, url)` unik dan `eventId` unik terbukti menolak duplikat.

Dua bug ditemukan & diperbaiki saat E2E:
1. Migrasi `webhook_endpoints.id` tidak punya `DEFAULT gen_random_uuid()` → insert gagal.
2. TypeORM mengembalikan `[rows, count]` untuk `UPDATE … RETURNING` (bukan `rows`) → klaim
   delivery/fan-out harus dinormalisasi (`rowsOf`).

Sisa untuk Stage 5 (belum dikerjakan): halaman dashboard web untuk mengelola endpoint,
endpoint replay event, dan pengiriman `payment_link.paid` (V3) ke webhook.
