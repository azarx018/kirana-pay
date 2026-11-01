# MVP V3 — Payment Link: audit (Stage 0) dan rencana (Stage 1)

Branch kerja: `feat/mvp-v3-payment-link` (dari `audit/hardening-2026-11`).
Spec sumber: `kirana_pay_mvp_v3_payment_link_prompt.md` (dari pemilik).

## 1. Hasil audit repo (fakta, sudah diverifikasi)

| Hal | Temuan |
|---|---|
| Baseline | `pnpm --filter @kirana-pay/api test`: 7 suite / 31 test hijau. `tsc --noEmit` API dan web bersih. |
| Status invoice | `PENDING`, `PAID`, `EXPIRED` saja. **Tidak ada `CANCELLED`** (ADR 0001: keputusan produk) dan DB `CHECK` menolak status lain. |
| Expiry | Lazy: `InvoicesService.sweepExpired(merchantId)` dijalankan saat merchant membaca/konfirmasi. Tidak ada scheduler. |
| Jalur ke `PAID` | Hanya `POST /v1/invoices/:id/confirm-payment` (session, bukan API key). |
| Audit invoice | `invoice_events` dengan `CHECK type IN ('CREATED','PAYMENT_CONFIRMED','EXPIRED')`. Menambah tipe berarti mengubah constraint V2. |
| Auth | `SessionGuard` (cookie) dan `ApiKeyOrSessionGuard`. `AuthContext{userId, merchantId, role, via}`. API key menghasilkan `userId=''`. |
| Tenant | `InvoicesService.findOwned(merchantId, idOrPublicId)` → `404` untuk invoice milik merchant lain. Sudah `export`. |
| QR | PNG dibuat engine saat invoice dibuat, disimpan lewat `FileStorage` (`qrPath`, `qrSha256`). Download hanya via `GET /v1/invoices/:id/qr` (private, butuh auth). |
| Token util | `auth/tokens.ts` (`randomBytes`, `sha256`). Dipakai untuk session dan API key. |
| Rate limit | `ThrottlerGuard` global 120/menit. Override per route dengan `@Throttle`. `TRUST_PROXY` sudah ada. |
| Error | `AllExceptionsFilter` → `{success:false,error:{code,message}}`, 5xx disamarkan. |
| Header | `securityHeaders` API: nosniff, DENY, no-referrer, CORP same-origin. Tidak ada CORS (semua same-origin lewat rewrite Next). |
| Migrasi | Terdaftar manual di `app.module.ts` (`migrations: [...]`), `migrationsRun: true`. |
| Web | Next.js 15, hanya route `/` (Dashboard). Tab Invoice di `components/InvoiceTab.tsx` (detail + konfirmasi). Proxy `/v1/*` → API via `next.config.ts`. Tidak ada framework test frontend. |
| Test integrasi | Konvensi repo = `scripts/e2e.sh` (stack nyata). Jest hanya unit. |
| Infra | `docker-compose.yml` (api, qr-engine, postgres), `docker-compose.override.yml` (web). |

## 2. Konflik spec vs repo dan keputusan konservatif

1. **`CANCELLED` tidak ada.** Tidak ditambahkan (mengubah semantik V2). Public page menangani `PAYABLE`, `PAID`, `EXPIRED`, dan tidak tersedia (revoked/invalid/status tak dikenal). Baris `CANCELLED` pada tabel spec tidak berlaku sampai V2 punya pembatalan.
2. **Audit link disimpan di tabel `payment_links` sendiri** (pembuat, pencabut, timestamp). `invoice_events` tidak disentuh karena `CHECK`-nya akan berubah.
3. **Token bisa ditampilkan ulang** (kebutuhan UX: merchant harus bisa menyalin URL lagi dan POST berulang harus mengembalikan link yang sama). Hash-only tidak memungkinkan itu. Desain:
   - Token = `nonce` (16 byte acak, base64url 22 char) + `mac` (HMAC-SHA256 dipotong 16 byte, 22 char) = 44 char.
   - `mac = HMAC(PAYMENT_LINK_SECRET, "kp-payment-link:v1:" + nonce)`.
   - DB hanya menyimpan `nonce`. Bocornya DB saja tidak cukup untuk membentuk URL valid.
   - Verifikasi MAC (timing-safe) dilakukan **sebelum** query DB, jadi token acak/rusak tidak menyentuh DB.
   - Hanya primitif standar `node:crypto` (HMAC, timingSafeEqual, randomBytes). Tidak ada kripto buatan sendiri.
   - Konsekuensi: mengganti `PAYMENT_LINK_SECRET` mematikan semua link aktif. Didokumentasikan.
4. **Endpoint publik di `/v1/public/payment-links/:token`** (bukan `/public/...`) agar otomatis lewat rewrite `/v1/*` yang sudah ada (tanpa ubah proxy) dan tetap berversi.
5. **QR di respons publik sebagai data URL** hanya saat `PAYABLE`. Satu endpoint = satu gerbang (revoke/expired/paid otomatis menghilangkan QR), tanpa path file bocor, tanpa endpoint gambar kedua.
6. **Akses link tidak boleh mengubah apa pun.** Endpoint publik read-only: expiry dihitung dengan jam DB (`expiresAt <= now()`) tanpa menulis `EXPIRED`.
7. **Endpoint merchant hanya session** (API key di luar scope V3, spec bagian 4). Dibutuhkan juga untuk audit `createdByUserId`.
8. **Nama merchant publik = `merchants.name`.** Email/telepon/ID internal tidak pernah diekspos.
9. **Konfigurasi baru** `PUBLIC_BASE_URL` dan `PAYMENT_LINK_SECRET`. Kalau tidak valid di production, fitur mengembalikan `503 PAYMENT_LINK_NOT_CONFIGURED`; **boot tidak diblokir** (tidak merusak deploy yang ada). URL tidak pernah diturunkan dari header `Host`.

## 3. Lifecycle

```text
link: ACTIVE ──revoke──▶ REVOKED (permanen, token tidak pernah hidup lagi)
invoice (V2, tidak berubah): PENDING ─▶ PAID | EXPIRED
```

Status publik (turunan, read-only): `PAYABLE` = link ACTIVE + invoice PENDING + belum lewat `expiresAt`.
`PAID` = invoice PAID. `EXPIRED` = invoice EXPIRED atau PENDING yang sudah lewat. Link REVOKED / token tidak valid /
status tak dikenal → `404 PAYMENT_LINK_UNAVAILABLE` (generik, sama untuk semuanya).

## 4. Skema (migration `1700000002000-PaymentLinks`)

`payment_links`: `id uuid pk`, `invoiceId uuid fk invoices ON DELETE RESTRICT`, `tokenNonce varchar(22) unique`,
`status varchar(16) CHECK IN ('ACTIVE','REVOKED') default 'ACTIVE'`, `createdAt`, `createdByUserId fk users SET NULL`,
`revokedAt`, `revokedByUserId fk users SET NULL`, `CHECK` konsistensi status↔`revokedAt`.
Index: **partial unique `(invoiceId) WHERE status='ACTIVE'`** (satu link aktif per invoice, aman dari race),
`(invoiceId, createdAt DESC)`, unique `tokenNonce`.
Tidak ada kolom `merchantId` (turunan dari invoice). Tenant dicek lewat `findOwned`.

## 5. Pembagian kerja (2 agent)

| | Agent A (backend, ini) | Agent B (frontend) |
|---|---|---|
| Area | `apps/api/**`, `docs/**`, `scripts/e2e.sh`, `docker-compose*.yml`, `.env.example`, `AGENTS.md` | **hanya `apps/web/**`** |
| Tugas | Stage 2 dan 3, e2e, verifikasi akhir (Stage 6), review hasil B | Stage 4 dan 5 sesuai `docs/v3/AGENT_B_BRIEF.md` |
| Kontrak | `docs/v3/CONTRACT.md` (dibekukan; perubahan hanya oleh A) | Membangun terhadap kontrak itu |

Aturan bentrok: B tidak mengedit `apps/api`, A tidak mengedit `apps/web`. Temuan lintas area ditulis di `docs/v3/HANDOFF.md`.

## 6. Daftar file yang akan berubah (Agent A)

Baru: `entities/payment-link.entity.ts`, `migrations/1700000002000-PaymentLinks.ts`, `payment-links/*`
(token, config, view/state, service, 2 controller, module, spec), `docs/v3/*`.
Ubah: `app.module.ts`, `docker-compose.yml`, `.env.example`, `apps/api/.env.example`, `docs/api.md`, `scripts/e2e.sh`, `AGENTS.md`, `README.md`.

## 7. Perintah verifikasi

```bash
pnpm --filter @kirana-pay/api lint && pnpm --filter @kirana-pay/api test && pnpm --filter @kirana-pay/api build
pnpm --filter @kirana-pay/web typecheck && pnpm --filter @kirana-pay/web build
bash scripts/e2e.sh        # stack nyata (DB uji terpisah, jangan DB produksi)
```
