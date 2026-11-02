# AGENTS.md — Konteks Kirana Pay untuk AI agent

Baca file ini dulu sebelum mengubah apa pun. Beberapa agent bekerja di repo yang sama,
jadi jaga perubahan tetap kecil, terfokus, dan terdokumentasi.

## 1. Apa ini

Kirana Pay adalah sistem "payment gateway versi murah", **bukan** payment gateway sungguhan
seperti Midtrans/Xendit. Ide dasarnya:

1. Merchant upload **QRIS statis** miliknya sendiri (dari DANA Business, GoPay Merchant,
   ShopeePay Merchant, dst.).
2. Kirana Pay mengubahnya jadi **QRIS dinamis** (nominal tertentu) untuk dipakai aplikasi POS /
   checkout / invoice.
3. Kirana Pay **tidak pernah memegang dana**. Uang masuk langsung ke akun e-wallet merchant
   lewat acquirer-nya. Kita hanya menghasilkan QR dan memverifikasi pembayaran sudah masuk.

Target akhir: SaaS publik berlangganan. Saat ini masih pengembangan, **banyak bug dan fitur
belum sinkron**. Jangan berasumsi sesuatu sudah berfungsi tanpa mengecek/menguji.

## 2. Arah produk dan keputusan dari pemilik (WAJIB dipatuhi)

- Pemilik sudah memahami risiko bisnis/legal/teknis proyek ini. **Peran agent: engineering
  kode.** Jangan ceramah soal izin, regulasi, atau kelayakan bisnis.
- **Nominal yang dibayar customer TIDAK BOLEH diubah** (tidak ada "kode unik" yang
  ditambah/dikurangi ke nominal). Customer harus bayar persis sesuai invoice.
- **Target pengguna:** pelaku UMKM (non-teknis) dan developer (integrasi lewat API key).
  Artinya API harus rapi, konsisten, dan terdokumentasi, sedangkan UI harus sederhana dan
  ramah untuk orang awam (bahasa Indonesia yang jelas, pesan error yang bisa dipahami).
- **Urutan prioritas: backend dan inti dulu, frontend paling akhir.** Jangan buang waktu
  memoles atau mendesain ulang `apps/web` sebelum inti (matching pembayaran, integrasi,
  stabilitas API) beres. Perubahan frontend sekarang hanya untuk menjaga agar tidak rusak
  akibat perubahan API.
- **Kualitas kode:** rapi dan mudah dibaca. Satu tanggung jawab per modul, nama jelas,
  tanpa kode mati atau file sementara, logika murni dipisah dari I/O supaya bisa di-unit-test,
  dan kontrak API stabil karena developer eksternal akan bergantung padanya.
- QR engine (Rust) dianggap **stabil** dan sudah diuji end-to-end. Jangan refactor besar tanpa
  alasan kuat dan tanpa menjalankan seluruh test engine.
- Prinsip yang sudah ada dan dipertahankan: membuat/melihat/mengunduh QR **tidak pernah**
  menandai invoice lunas.

## 3. Arsitektur

| Komponen | Teknologi | Port | Catatan |
|---|---|---|---|
| `apps/api` | NestJS 11 + TypeORM + PostgreSQL | 3000 (host 3200 di Docker) | auth, QRIS, invoice, API key, dashboard statis |
| `apps/web` | Next.js 15 | 3100 | dashboard (light/dark, tab Invoice) |
| `services/qr-engine` | Rust + Axum | 8081 (internal) | decode, validasi, transform, render QR |
| PostgreSQL | 16 | internal | migrasi TypeORM jalan otomatis saat boot (`migrationsRun: true`, `synchronize` off) |

Alur konversi: API → HTTP internal → qr-engine (`/internal/qr/convert`) → payload + PNG.
Transformasi (lihat `services/qr-engine/src/transformer/mod.rs`): tag `01`→`12`, tag `54`→
`"{amount}.00"`, `note` opsional digabung ke tag `62` subtag `05` (reference label) dengan
subtag lain tetap utuh (terutama `07`), field diurutkan, tag `63` dihitung ulang (CRC16-CCITT).

Model data: `users ─< merchant_members >─ merchants ─< merchant_qris >─ payment_providers`,
plus `qr_jobs`, `api_keys`, `invoices`, `invoice_events`, `sessions`.
Semua query milik merchant **wajib** difilter dengan merchant dari kredensial (multi-tenant).
Resource milik merchant lain harus menghasilkan `404`, bukan `403` (tidak bocor eksistensi).

Dokumen lain: `README.md`, `docs/api.md` (kontrak + error code), `docs/architecture.md`,
`docs/deploy.md`, `docs/adr/0001-invoices.md`, `docs/security-audit-2026-11.md`.

## 4. Status invoice saat ini

- Status: `PENDING` → `PAID` | `EXPIRED`. Expired ditegakkan secara lazy (`sweepExpired`),
  default 60 menit, dan tidak pernah menimpa `PAID`.
- Satu-satunya jalur ke `PAID` saat ini: `POST /v1/invoices/:id/confirm-payment`, konfirmasi
  **manual** oleh user merchant yang login (`confirmationMethod = 'MANUAL_MERCHANT'`),
  tidak bisa lewat API key, dan tercatat di `invoice_events` (`PAYMENT_CONFIRMED`).
- Tiap invoice punya `id` (UUID) dan `publicId` (`INV-` + 12 karakter base32). **Keduanya
  hanya ada di database. Belum masuk ke payload QR**: `InvoicesService.create` memanggil
  `engine.convert(image, amount)` tanpa parameter `note`.
- Belum ada constraint yang mencegah dua invoice `PENDING` dengan nominal sama pada QRIS yang
  sama.

## 4b. MVP V3 — Payment Link (backend selesai, frontend dikerjakan Agent B)

Branch: `feat/mvp-v3-payment-link`. Dokumen: `docs/v3/PLAN.md` (audit + keputusan), `docs/v3/CONTRACT.md`
(kontrak API, dibekukan), `docs/v3/AGENT_B_BRIEF.md` (tugas frontend), `docs/v3/HANDOFF.md` (catatan antar-agent).

- Pembagian area: Agent A = `apps/api/**`, `docs/**`, `scripts/`, compose, env. Agent B = **hanya `apps/web/**`**.
  Jangan saling mengedit area lain; tulis temuan di `docs/v3/HANDOFF.md`.
- Link pembayaran = URL publik untuk SATU invoice V2 yang sudah ada. Tidak membuat invoice, tidak memverifikasi
  pembayaran, tidak pernah mengubah status invoice. Satu link ACTIVE per invoice (partial unique index).
- Token = nonce + HMAC (`PAYMENT_LINK_SECRET`); hanya nonce yang disimpan. Endpoint publik read-only dan
  `404 PAYMENT_LINK_UNAVAILABLE` identik untuk token salah/dicabut. QR hanya ikut respons saat `PAYABLE`.
- Env baru: `PUBLIC_BASE_URL`, `PAYMENT_LINK_SECRET` (wajib di production, jika tidak fitur membalas 503).
- Status `CANCELLED` tidak ada (ADR 0001). Jangan ditambahkan tanpa keputusan pemilik.

## 4c. MVP V4 — Developer API & Webhook (sedang dikerjakan)

Branch: `feat/mvp-v4-developer-api-webhook`. Rencana + keputusan yang disetujui pemilik: `docs/v4/PLAN.md`.
- Stage 2 selesai: API key punya `scopes`, `expiresAt`, audit pembuat/pencabut, rotasi atomik, `Authorization: Bearer`
  (plus `x-api-key` lama). `ScopeGuard` + `@RequireScopes()` setelah autentikasi. Tidak ada scope untuk menandai lunas.
- Stage 3 selesai: `/v1/developer/*` (key only, DTO publik stabil, `Idempotency-Key`, keyset pagination, strict fields
  lewat `StrictFieldsGuard`, throttler per-key, body JSON maks 32 kb). Route lama `/v1/invoices` tidak diubah bentuknya.
  Catatan penting: pipe global `whitelist:true` membuang field tak dikenal SEBELUM pipe route; penolakan eksplisit harus
  lewat guard (`@StrictFields`), jangan lewat `@UsePipes`.
- Aturan: API key tidak boleh menjangkau `confirm-payment` (session only). Jangan menambah scope tanpa migrasi
  (CHECK constraint `chk_api_keys_scopes` mengunci himpunan scope).
- `scripts/check-migration-api-keys.cjs` memverifikasi migrasi di DB scratch (menolak nama DB tanpa "test"/"scratch").

## 5. Rencana: verifikasi pembayaran otomatis (BELUM DIBUAT)

Dua jalur direncanakan, keduanya bermuara ke satu aturan matching di backend:

1. **APK Android native** yang mendengarkan notifikasi aplikasi merchant (DANA, GoPay,
   ShopeePay, dll.) lalu mengirim event ke backend. Sifatnya **bukti lemah**: notifikasi bisa
   dipalsukan, listener bisa mati karena battery optimization, format bisa berubah.
2. **API langsung ke merchant** (mis. repo konektor GoBiz yang ditemukan pemilik). Masih
   eksperimental dan tidak resmi, jadi harus diisolasi di balik interface provider supaya bisa
   diganti/dimatikan tanpa mengganggu inti.

Prinsip desain untuk matching (nominal tidak boleh diubah, lihat bagian 2):

- Kirim `publicId` sebagai `note` ke engine agar masuk reference label (tag 62/05), dan
  gunakan sebagai penanda tambahan **hanya bila** provider/API memang mengembalikannya.
  Jangan mengandalkan field ini untuk notifikasi karena belum terbukti muncul.
- Cegah ambiguitas: satu invoice `PENDING` aktif per kombinasi (QRIS, nominal) lewat partial
  unique index di DB, dengan perilaku jelas saat bentrok (tolak dengan error code khusus atau
  antrekan). Keputusan perilaku ini masih terbuka, tanyakan ke pemilik sebelum memilih.
- Event pembayaran dari luar harus **idempoten** (dedupe, misalnya lewat hash event atau
  ID transaksi dari sumber), ber-scope merchant, dan menyimpan sumber bukti.
- Bukti dari notifikasi Android sebaiknya diberi label terpisah dari konfirmasi API/manual
  (misal `confirmationMethod`: `NOTIFICATION`, `PROVIDER_API`, `MANUAL_MERCHANT`) dan tercatat
  di `invoice_events`. Kalau cocok ambigu (lebih dari satu kandidat), jangan tebak: biarkan
  `PENDING` dan minta konfirmasi manual.
- Token/kredensial merchant untuk integrasi provider harus dienkripsi at-rest dan tidak
  pernah muncul di log. Jangan menyimpan password e-wallet.
- Endpoint penerima event butuh autentikasi per perangkat/merchant (mis. device key), bukan
  endpoint publik terbuka.

## 6. Cara kerja lokal

```bash
pnpm install
cargo build --manifest-path services/qr-engine/Cargo.toml
cp apps/api/.env.example apps/api/.env
QR_ENGINE_PORT=8081 ./services/qr-engine/target/debug/qr-engine   # terminal 1
cd apps/api && pnpm start:dev                                      # terminal 2
```

Test:

```bash
pnpm --filter @kirana-pay/api test
cargo test --manifest-path services/qr-engine/Cargo.toml
bash scripts/e2e.sh        # butuh stack berjalan
```

Docker: `cp .env.example .env && docker compose up -d --build` (API di `${API_HOST_PORT:-3200}`).
VM butuh `sudo` untuk docker. Detail di `docs/deploy.md`.

## 7. Aturan kerja untuk agent

- Ubah skema hanya lewat **migration baru** di `apps/api/src/migrations/` (jangan edit migration
  lama, jangan nyalakan `synchronize`).
- Jumlah uang selalu **integer rupiah** (`bigint` di DB). Jangan pakai floating point.
- Format error API: `{ "success": false, "error": { "code", "message" } }`. Tambah code baru
  ke `docs/api.md` bila membuat code baru.
- Setiap perubahan perilaku harus disertai unit test, dan `docs/api.md` diperbarui.
- Jangan commit secret, `.env`, atau data merchant. Jangan log payload QRIS lengkap atau
  kredensial.
- Commit kecil dengan pesan gaya yang sudah dipakai (`feat(...)`, `fix(...)`, `docs: ...`).
  Kerjakan di branch terpisah, jangan langsung ke `main`.
- Jangan menyentuh file di luar tugasmu. File `services/qr-engine/tests/dump_tmp.rs` dan
  `perf_tmp.rs` adalah file sementara milik pemilik (untracked); biarkan.
- Kalau ada yang ambigu soal keputusan produk, **tanya pemilik**, jangan menebak.

## 8. Ketidaksesuaian dokumentasi yang diketahui

- (Sudah diperbaiki di V3) `README.md` "Known limitations" dulu menyebut "no invoices or payment links yet".
- `apps/api/src/data-source.ts` (dipakai script `migration:*` CLI) belum mendaftarkan entity/migration invoice dan
  payment link; runtime aplikasi memakai daftar di `app.module.ts`. Sinkronkan sebelum memakai CLI migrasi.
- Baca `docs/` dengan kritis: ada dokumen brief awal (`kirana_pay_*_prompt.md`) yang bisa
  sudah usang terhadap kode.

## 9. Daftar tugas yang disarankan (urut prioritas)

1. Kirim `publicId` sebagai `note` saat membuat invoice + unit test.
2. Partial unique index pada invoice `PENDING` per (QRIS, nominal) + keputusan perilaku bentrok.
3. Tabel dan endpoint penerima event pembayaran (idempoten, per perangkat) + aturan matching.
4. Interface provider (`PaymentVerifier`) untuk memisahkan jalur notifikasi dan API merchant.
5. Rapikan inkonsistensi dokumentasi dan bug dashboard yang belum sinkron.
