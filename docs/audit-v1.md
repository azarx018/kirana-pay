# Audit v1 — multi-tenant merchant management

Tanggal: 31 Oktober 2026 · Basis commit: v1 multi-tenant · Lingkup: backend API, auth, dashboard.

## Ringkasan

| # | Temuan | Severity | Status |
|---|---|---|---|
| 1 | Rate limit login/register **tidak aktif** (ThrottlerGuard tidak terdaftar global, `@Throttle` inert) | HIGH | fixed |
| 2 | Kotak API key bertuliskan "tidak bisa dilihat lagi" tapi tetap tampil terus | MED | fixed |
| 3 | Tombol salin API key gagal di konteks non-HTTPS (akses via IP tailnet) | MED | fixed |
| 4 | `prompt()`/`alert()` native di UI (blokir render, jelek di mobile) | LOW | fixed |
| 5 | Input keterangan/nama key sempit (selector CSS salah sasaran) | LOW | fixed |
| 6 | Navbar belum ada, navigasi pakai tab terpisah | LOW | fixed |
| 7 | Job lama `qr_jobs` tanpa `merchant_id` tidak tampil di dashboard | LOW | open (by design) |
| 8 | Password reset belum ada (tidak ada email delivery) | LOW | open |
| 9 | CSRF token eksplisit tidak ada (mengandalkan SameSite=Lax) | LOW | accepted |
| 10 | `COOKIE_SECURE=false` karena dilayani HTTP di tailnet | LOW | accepted |

## Bukti verifikasi (dijalankan)

```text
login x9 salah password      -> 401 401 401 401 401 401 401 401 429   (rate limit aktif)
GET /v1/qris tanpa sesi      -> 401
GET /v1/qris/:id/image       -> 401   (tanpa sesi)
GET /v1/qr/:id/image         -> 401
cross-tenant qris/job        -> 404   (scripts/e2e.sh)
API key merchant lain        -> 404 / 401
```

Pemeriksaan statis:

- Semua controller: `@UseGuards` — `SessionGuard` (dashboard) atau `ApiKeyOrSessionGuard` (`/v1/qr/*`).
- Tidak ada `console.log` yang mencetak token/password.
- API key disimpan sebagai SHA-256; response list hanya `prefix` + `lastUsedAt`, plaintext hanya sekali saat create/rotate.
- Cookie sesi: `httpOnly`, `SameSite=Lax`, `Path=/`, TTL 14 hari, token acak 32 byte, hash di DB.
- Password: Argon2id (`m=19456, t=2, p=1`), minimum 10 karakter.
- Upload: batas `MAX_UPLOAD_BYTES` (default 5 MB), cek magic bytes, wajib lolos decode + validasi QRIS di engine.
- Provider: registry `payment_providers` (seed), kode stabil, bukan hasil tebakan payload.

## Perbaikan UI/UX

- Navbar sticky: brand, tab Generator / QRIS / Pengaturan, nama merchant + Keluar. Mobile: tab pindah ke baris kedua.
- API key: penjelasan fungsi, field nama key inline, key muncul sekali dengan tombol **Salin** + **Sembunyikan**, auto-hide 60 detik, hilang saat pindah tab / logout / reload.
- `alert()` diganti toast; `prompt()` diganti input inline.
- Label & input konsisten lebarnya; riwayat menampilkan status + waktu.

## Batasan yang masih berlaku

1. Belum ada verifikasi pembayaran otomatis — QR valid secara struktur, bukan bukti dana masuk.
2. Provider dipilih manual oleh merchant; tidak ada deteksi otomatis dari payload.
3. Belum ada role selain `OWNER` (model sudah siap untuk `merchant_members.role`).
4. Belum ada audit log aktivitas (login, buat/revoke key).
5. Belum ada rotasi sesi otomatis / daftar sesi aktif di UI.
6. Penyimpanan gambar masih driver lokal (`var/qr`); interface `FileStorage` siap diganti S3.
