# Audit Keamanan & Hardening — November 2026

> Lanjutan dari `docs/audit-v1.md`. Dikerjakan pada **salinan** repo
> (`/home/mcp/workspace/kirana-pay`, branch `audit/hardening-2026-11`) supaya tidak
> bentrok dengan agent lain yang sedang mengubah repo asli. Belum ada perubahan di
> `/home/agentuser/kirana-pay`.

## 1. Ringkasan

| | |
|---|---|
| Cakupan | API NestJS, dashboard Next.js + dashboard statis lama, `qr-engine` (Rust), Docker/compose, dependency |
| Metode | Review kode manual, `pnpm audit --prod`, cek riwayat git untuk secret, cek konfigurasi runtime VPS (hanya baca) |
| Tidak dicakup | Isi `.env` dan database (sengaja tidak dibaca), build Docker (tidak ada akses docker di lingkungan audit), tes terhadap database sungguhan, pentest dinamis |
| Verifikasi | `tsc --noEmit` lolos, `jest` 31/31 (sebelumnya 20), `cargo test` 23/23 (sebelumnya 20), `nest build`, `next build`, dan `cargo build` tanpa warning |
| Hasil | 19 temuan diperbaiki dan sudah di-merge, 1 perlu tindakan operasional manual, sisanya masuk backlog (bagian 4) |

Asumsi lama di `audit-v1.md` yang **sudah tidak berlaku**: app dianggap hanya
dilayani lewat HTTP di dalam tailnet. Kenyataannya Tailscale Funnel meneruskan
`/` ke port 3100 sehingga dashboard (termasuk halaman register) terbuka ke
internet publik. Risiko "cookie tanpa Secure" yang dulu diterima menjadi nyata.

## 2. Temuan yang sudah diperbaiki di branch

| ID | Tingkat | Temuan | Perbaikan |
|---|---|---|---|
| F-02 | Tinggi | Tanpa `trust proxy`, semua klien di belakang proxy (Funnel, rewrite Next, Caddy) terlihat memakai satu IP. Rate limit per-IP jadi **satu bucket global**: 8 login/menit untuk seluruh dunia, sehingga satu penyerang bisa mengunci semua user. | `app.set('trust proxy', …)` lewat env `TRUST_PROXY` (jumlah hop). Perlu diisi saat deploy, lihat bagian 3. |
| F-03 | Sedang | `COOKIE_SECURE` default `false` (kode dan compose). | Default `true` di production (`isCookieSecure()`), compose default `true`. Set `false` hanya untuk HTTP murni. |
| F-04 | Sedang | Port 3100 (web) dan 3200 (API) di-publish ke `0.0.0.0`. Terlihat di `ss -tlnp` host. | Compose mengikat ke `127.0.0.1`. Funnel dan reverse proxy lokal tetap bisa menjangkau. |
| F-05 | Sedang | Swagger `/docs` dan `/docs-json` publik (juga lewat rewrite Next). | Nonaktif di production kecuali `ENABLE_SWAGGER=true`. |
| F-06 | Sedang | Password DB hardcoded di `docker-compose.yml` dan fallback `'kirana'` di `app.module.ts`. | Compose memakai `${DB_PASSWORD:?…}`. Di production, boot **gagal** jika `DB_PASSWORD` kosong atau `kirana` (escape hatch sementara: `ALLOW_INSECURE_DEFAULTS=true`). |
| F-07 | Sedang | `*.key`/`*.crt` (sertifikat Tailscale) ada di root repo dan tidak di-ignore. Satu `git add .` bisa meng-commit private key. Riwayat git sudah dicek: belum pernah ter-commit. | `.gitignore` memblokir `*.key *.crt *.pem *.p12 .env.*`. Disarankan memindahkan file itu keluar dari repo. |
| F-08 | Tinggi | `multer 2.4.0` (DoS, advisory high) di semua endpoint upload; `postcss` (2 high, 2 moderate) via Next; `js-yaml` via swagger. | `pnpm.overrides` di root: `multer>=2.5.0`, `postcss>=8.5.23`, `js-yaml>=5.4.1`. Sisa 2 moderate, lihat B-09. |
| F-09 | Sedang | Role tidak ditegakkan. `PATCH /v1/merchant` berkomentar "owner only" tapi tidak mengecek. User `STAFF` bisa membuat/revoke API key, mengganti/mengarsipkan QRIS. | `assertOwner()` di merchant, api-keys, dan QRIS (create/replace/archive). Laten: saat ini belum ada alur membuat STAFF. |
| F-10 | Rendah | Login tidak melakukan kerja argon2 saat email tidak ada, sehingga selisih waktu membocorkan email terdaftar (komentar kode mengklaim sebaliknya). | Verifikasi terhadap dummy hash agar waktunya sama. (Register tetap membalas `EMAIL_TAKEN`, lihat B-06.) |
| F-11 | Rendah | Mengganti atau mengarsipkan QRIS (= mengubah tujuan uang) tidak meninggalkan jejak. | Log `AUDIT qris.replace/archive` berisi merchant, qris, user, dan perubahan NMID. File gambar lama sengaja **tidak dihapus** (bukti forensik). |
| F-12 | Rendah | `MAX_UPLOAD_BYTES` dibaca saat import modul, sebelum `.env` dimuat. Nilai dari `.env` diam-diam diabaikan di luar Docker. | `src/env.ts` memuat `.env` sebagai import pertama `main.ts` (`process.loadEnvFile`). |
| F-13 | Rendah | Error validasi mengembalikan `message` berupa array, melanggar kontrak `{code, message}`. | Digabung menjadi satu string. |
| F-14 | Rendah | Sesi kedaluwarsa hanya dihapus jika dipresentasikan lagi. Update `lastUsedAt` fire-and-forget tanpa `.catch`. | Pembersihan saat login, dan promise ditangani. |
| F-15 | Rendah | Tidak ada header keamanan, `X-Powered-By` aktif. | Middleware API dan `headers()` di Next: nosniff, frame DENY, referrer, permissions, HSTS (hanya saat HTTPS). **CSP belum**, lihat B-05. |
| F-16 | Info | Peringatan `API_KEY is not set` sudah usang (auth sekarang multi-tenant). | Dihapus agar tidak menyesatkan. |
| F-17 | Sedang | `qr-engine`: gambar didecode penuh sebelum dimensi dicek, sehingga file kecil yang sangat terkompresi memaksa alokasi besar (batas bawaan crate `image` ±512 MiB per decode, dan register terbuka). | Dimensi dibaca dari header lebih dulu (`into_dimensions`), lalu decode dengan `Limits` (lebar/tinggi 8000, alokasi maks 256 MiB). Ada tes baru. |
| F-18 | Sedang | `qr-engine`: decode CPU-bound berjalan langsung di handler async dan tanpa batas paralel. | `spawn_blocking` plus semaphore (`QR_ENGINE_MAX_CONCURRENT_DECODES`, default 4). |
| F-19 | Rendah | `qr-engine`: body JSON dibatasi 2 MB bawaan axum, padahal upload 5 MB (base64 ±6,7 MB). Gambar >1,5 MB gagal dengan error menyesatkan. | `DefaultBodyLimit` dihitung dari `QR_ENGINE_MAX_IMAGE_BYTES` (×4/3 + 64 KiB). |
| F-20 | Rendah | `QrEngineClient.convert` menganggap error bila key `success` ada di body, rapuh bila engine mulai mengirim `success: true`. | Hanya `success === false` yang dianggap error. |

## 3. Tindakan manual (tidak bisa dikerjakan lewat kode)

1. **Tutup mapping Funnel `/` → 3100** bila app belum untuk publik. Sisakan hanya path MCP.
   ```bash
   tailscale funnel status
   sudo tailscale funnel --help          # cek sintaks hapus path di versi terpasang
   ```
   Setelah itu uji dari jaringan di luar tailnet: `https://<host>.ts.net/` tidak boleh lagi menampilkan app.
   Untuk akses saat development gunakan `tailscale serve` (hanya tailnet), bukan `funnel`.
2. **Rotasi password DB** sebelum deploy branch ini. Mengubah `POSTGRES_PASSWORD` tidak mengubah password pada volume yang sudah ada:
   ```bash
   docker compose exec postgres psql -U kirana -d kirana_pay \
     -c "ALTER USER kirana WITH PASSWORD '<password-baru>';"
   # lalu isi DB_PASSWORD=<password-baru> di .env dan: docker compose up -d
   ```
3. **Isi `TRUST_PROXY`** di `.env`. Rantai saat ini Funnel → web (Next rewrite) → API, jadi mulai dari `2`. Verifikasi dengan mencoba login gagal dari dua jaringan berbeda: bucket rate limit harus terpisah. Jika IP klien tidak muncul benar, sesuaikan angkanya.
4. **Pindahkan `*.key`/`*.crt`** dari root repo ke luar repo (mis. `/etc/ssl/kirana/`), dan hapus dari working tree. Kalau sempat tersalin ke tempat lain, terbitkan ulang dengan `tailscale cert`.
5. **Firewall Tencent**: pastikan inbound hanya yang diperlukan. Port 3100/3200/18888/2222/3001 jangan terbuka publik.
6. **Backup**: volume `pgdata` dan `qrdata` (gambar QRIS) belum punya jadwal backup yang terdokumentasi.

## 4. Backlog (belum dikerjakan, urut prioritas)

| ID | Tingkat | Item | Catatan |
|---|---|---|---|
| B-04 | Sedang | Container `api`/`web` berjalan sebagai root, image menyalin seluruh builder (devDependencies, source). | `USER node`, multi-stage dengan `pnpm deploy --prod`, `chown` volume `/app/var/qr` (volume lama dimiliki root, jadi perlu migrasi izin). Tidak diterapkan: tidak ada akses docker untuk mengujinya. |
| B-05 | Sedang | Belum ada CSP. Dashboard lama memakai `innerHTML` (data user sudah di-escape, `id/status` dari server), dan layout Next memakai inline script untuk tema. | CSP berbasis nonce untuk Next, dan pensiunkan `apps/api/public` bila sudah digantikan Next. |
| B-06 | Sedang | `POST /v1/auth/register` terbuka untuk publik dan membocorkan email terdaftar (`EMAIL_TAKEN`). | Keputusan produk: undangan/allowlist, verifikasi email, atau CAPTCHA. |
| B-07 | Rendah | Tidak ada ganti/reset password dan tidak ada "logout semua sesi". | Perlu sebelum rilis. |
| B-08 | Rendah | Kursor pagination invoice hanya memakai `createdAt`, dan JS memotong presisi mikrodetik Postgres menjadi milidetik, sehingga item bisa terlewat di batas halaman. `sweepExpired` melakukan UPDATE pada setiap GET. | Kursor berupa `id` baris terakhir dengan perbandingan `(createdAt, id) < (SELECT … WHERE id = :cursor)`; pindahkan sweep ke job terjadwal. Tidak diterapkan karena SQL-nya belum bisa diuji ke Postgres sekali pakai. Web saat ini belum memakai kursor. |
| B-09 | Rendah | 2 advisory moderate tersisa: `glob`/`minimatch` via `typeorm` (jalur CLI). | Naikkan TypeORM saat ada rilis yang menaikkan `glob`. Tidak di jalur request. |
| B-10 | Sedang | Tidak ada tes untuk `AuthService`, guard, dan `InvoicesService` (khususnya race `confirmPayment` dan isolasi antar-merchant). | Tes integrasi dengan Postgres sekali pakai (testcontainers). |
| B-12 | Rendah | Audit QRIS baru berupa log, bukan tabel. Belum ada notifikasi/re-auth saat QRIS diganti. | Tabel `audit_events` + konfirmasi password untuk operasi sensitif. |
| B-13 | Info | Penyimpanan gambar memakai path relatif `./var/qr` jika `STORAGE_LOCAL_DIR` tidak di-set. | Wajibkan path absolut di production. |

## 5. Yang sudah baik (jangan diubah tanpa alasan)

- Argon2id untuk password; session token dan API key hanya disimpan sebagai SHA-256.
- Semua query data scoped `merchantId`; invoice/QRIS orang lain membalas 404 (tanpa kebocoran keberadaan).
- `confirmPayment` atomik (`UPDATE … WHERE status='PENDING' AND expiresAt > now()`), hanya via session, tercatat di `invoice_events`.
- Constraint DB untuk status/jumlah/expiry, FK `RESTRICT` pada invoice, magic-byte sniffing upload, `ValidationPipe` whitelist.
- `qr-engine` tidak punya port host (jaringan internal compose), PostgreSQL host hanya di `127.0.0.1`.

## 6. Serah terima ke agent lain

Perubahan ada di branch `audit/hardening-2026-11` pada salinan
`/home/mcp/workspace/kirana-pay`, plus patch `/home/mcp/workspace/kirana-pay-audit.patch`.
Perubahan sengaja kecil dan tidak memformat ulang file yang tidak disentuh.

```bash
# opsi A: ambil sebagai branch ke repo asli (tidak mengubah working tree)
cd /home/agentuser/kirana-pay
git fetch /home/mcp/workspace/kirana-pay audit/hardening-2026-11:audit/hardening-2026-11
git diff main...audit/hardening-2026-11 --stat      # tinjau dulu
git merge audit/hardening-2026-11

# opsi B: terapkan patch
git apply --check /home/mcp/workspace/kirana-pay-audit.patch && git apply /home/mcp/workspace/kirana-pay-audit.patch
```

Setelah merge: `pnpm install`, `pnpm --filter @kirana-pay/api lint && pnpm --filter @kirana-pay/api test`,
lalu lakukan langkah manual bagian 3 **sebelum** `docker compose up -d --build`
(tanpa `DB_PASSWORD` yang kuat, API akan menolak start di production).

### File yang berubah
- API: `main.ts`, `env.ts` (baru), `common/{runtime-config,roles,security-headers.middleware}.ts` (baru) beserta spec, `auth/*`, `merchant/*`, `api-keys/*`, `qris/*`, `app.module.ts`, `common/all-exceptions.filter.ts`
- Web: `apps/web/next.config.ts`
- Infra: `docker-compose.yml`, `docker-compose.override.yml`, `.env.example`, `.gitignore`
- Engine Rust: `Cargo.toml` (fitur `sync`), `config.rs`, `parser/image_decoder.rs`, `routes/{mod,qr}.rs`
- Dependency: `package.json` (`pnpm.overrides`), `pnpm-lock.yaml`

### Perubahan perilaku yang perlu diketahui agent lain
- Production menolak boot dengan `DB_PASSWORD` kosong/`kirana`.
- Cookie sesi `Secure` secara default: login via `http://` (mis. IP tailnet tanpa TLS) tidak akan menyimpan sesi. Set `COOKIE_SECURE=false` hanya untuk itu.
- `/docs` (Swagger) mati di production kecuali `ENABLE_SWAGGER=true`.
- Port host web/API hanya di loopback.
- Endpoint mutasi merchant/API-key/QRIS mensyaratkan role `OWNER`.
