# Agent B — Brief frontend MVP V3 (Payment Link)

Kamu Agent B. Agent A mengerjakan backend. Baca dulu, berurutan: `AGENTS.md`, `docs/v3/PLAN.md`,
`docs/v3/CONTRACT.md` (kontrak API, dibekukan). Spec lengkap dari pemilik: `kirana_pay_mvp_v3_payment_link_prompt.md`
(bagian 10 dan 13 paling relevan untukmu).

## Batas kerja (WAJIB)

- Kamu hanya boleh mengubah/menambah file di **`apps/web/**`**. Jangan menyentuh `apps/api`, `docs/api.md`,
  `scripts`, `docker-compose*`, `AGENTS.md`. Kalau kontrak kurang atau salah, **jangan** improvisasi: catat di
  `docs/v3/HANDOFF.md` (bagian "Dari B ke A") dan lanjutkan dengan asumsi paling konservatif.
- Jangan redesign dashboard. Pakai gaya, komponen, dan palet yang sudah ada (`globals.css`, `StatusPill`, `Toast`, dst.).
- Jangan menambah dependency npm. Tidak ada framework test frontend di repo ini; jangan menambahnya.
- Jangan membuat/mengubah Rust engine, migrasi, atau skema.
- Bahasa UI: Indonesia, kalimat jelas untuk pelaku UMKM non-teknis.
- Jangan mengklaim sesuatu lulus kalau tidak kamu jalankan dan lihat hasilnya.

## Tugas 1 — Tipe dan helper

- Tambahkan tipe `PaymentLinkView`, `PublicPaymentView`, dan `PublicState` di `apps/web/lib/types.ts` persis sesuai kontrak.
- Halaman publik **tidak** boleh memakai helper `api()` apa adanya karena helper itu mengirim cookie (`same-origin`).
  Buat fetch khusus: `cache: "no-store"`, `credentials: "omit"`, tanpa header kustom, parsing aman untuk body non-JSON.

## Tugas 2 — Bagian "Link Pembayaran" di detail invoice (dashboard)

Lokasi: tampilan detail di `components/InvoiceTab.tsx` (pecah ke komponen baru, mis. `PaymentLinkCard.tsx`, supaya file
tidak makin besar). Perilaku:

1. Saat detail dibuka: `GET /v1/invoices/:id/payment-link`. Tampilkan skeleton/loading, lalu salah satu keadaan:
   - `link = null`: tombol **Buat Link Pembayaran**.
   - `ACTIVE`: URL (read-only, bisa dipilih), tombol **Salin**, tombol **Buka** (`window.open(url, "_blank", "noopener,noreferrer")`), tombol **Cabut link**.
   - `REVOKED`: label "Dicabut" + waktu pencabutan; tombol **Buat link baru** hanya bila invoice masih `PENDING`.
2. Buat link: `POST` lalu tampilkan hasil. Cegah klik ganda (disable + label "Membuat…"). Error ditampilkan dengan `errMessage`.
3. Invoice `PAID`/`EXPIRED`: tombol buat dinonaktifkan dengan penjelasan satu kalimat ("Invoice sudah dibayar/kedaluwarsa, link baru tidak bisa dibuat"). Cabut tetap boleh bila ada link aktif.
4. **Salin**: pakai `lib/clipboard.ts` (`copyText`). Tampilkan toast sukses **hanya** bila hasilnya `true`; bila `false`, toast gagal + URL tetap bisa disalin manual.
5. **Cabut**: dialog konfirmasi (pola yang sama dengan konfirmasi pembayaran). Teks harus jelas bahwa link yang sudah dibagikan langsung berhenti bekerja dan tidak bisa diaktifkan lagi. Setelah `DELETE` sukses, perbarui kartu.
6. Berganti invoice di panel detail harus mereset state kartu (jangan menampilkan link invoice sebelumnya). Batalkan/abaikan respons usang (race saat klik cepat antar invoice).
7. Tambahkan teks pendukung: link hanya menampilkan tagihan; **pembayaran tetap harus dikonfirmasi manual oleh merchant**.

## Tugas 3 — Halaman publik `/pay/[token]`

File: `apps/web/app/pay/[token]/page.tsx` (+ komponen klien). Syarat:

- Halaman ini **tidak** merender `Dashboard`, tidak memanggil `/v1/auth/me`, tidak butuh login. Root layout (font, tema) boleh dipakai.
- Ambil data dari `GET /v1/public/payment-links/:token` (lewat rewrite `/v1/*` yang sudah ada; tidak perlu ubah proxy).
- Mobile-first (layar 360px), kontras aksesibel, label dan fokus keyboard benar, tanpa animasi berlebihan.
- Hierarki: identitas Kirana Pay/nama merchant → referensi invoice + deskripsi → **jumlah tagihan** → QR + instruksi singkat (hanya `PAYABLE`) → batas waktu → status → tombol "Perbarui status" → state khusus.
- State yang harus ada dan teksnya:
  - `PAYABLE`: tampilkan QR (`<img src={qrImageDataUrl}` dengan `alt` deskriptif), jumlah, batas waktu absolut (jam lokal) dan sisa waktu dihitung dari `serverTime` (**bukan** jam browser), instruksi: "Buka aplikasi bank atau e-wallet, pilih Scan/QRIS, lalu scan kode ini". Status: "Menunggu pembayaran". Teks pendamping wajib: "Status akan berubah setelah merchant mengonfirmasi pembayaran."
  - `PAID`: "Pembayaran sudah dikonfirmasi oleh merchant". **Tanpa QR.**
  - `EXPIRED`: "Tagihan sudah kedaluwarsa. Hubungi merchant untuk tagihan baru." **Tanpa QR.**
  - `404 PAYMENT_LINK_UNAVAILABLE`: satu pesan generik "Link pembayaran tidak tersedia atau sudah dinonaktifkan." (jangan bedakan sebabnya).
  - `429`: "Terlalu banyak permintaan, coba lagi sebentar lagi."
  - `503`/jaringan gagal/offline: pesan ramah + tombol coba lagi. Jangan tampilkan stack/detail teknis.
- **Larangan teks**: jangan pernah menulis "Pembayaran berhasil"/"berhasil dibayar" kecuali `state === "PAID"`, dan kalimatnya harus
  merujuk konfirmasi merchant. Jangan menyiratkan bahwa membuka, scan, atau refresh memverifikasi pembayaran.
  Tombol refresh harus disertai keterangan "Memperbarui status tidak memverifikasi pembayaran."
- Tidak ada hitung mundur berdetik. Sisa waktu cukup dihitung ulang saat data diperbarui.
- `description` dan `merchantName` wajib dirender sebagai teks React biasa (tidak ada `dangerouslySetInnerHTML`).
- Token tidak boleh di-log (`console.*`), tidak dikirim ke pihak ketiga, tidak ditaruh di query string.
- Metadata: `robots: { index: false, follow: false }`, `referrer: "no-referrer"` (pakai `export const metadata` di server wrapper
  bila komponen utamanya client component).

## Tugas 4 — Header untuk route publik

Di `apps/web/next.config.ts`, tambahkan blok `headers()` untuk `source: "/pay/:path*"`: `Cache-Control: no-store` dan
`X-Robots-Tag: noindex, nofollow`. Pertahankan header keamanan yang sudah ada.

## Verifikasi (jalankan sendiri, laporkan hasil nyata)

```bash
pnpm --filter @kirana-pay/web typecheck
pnpm --filter @kirana-pay/web build
```

Setelah Agent A melapor backend siap, uji manual terhadap API nyata (dev server web di 3100, API di 3000): buat invoice →
buat link → buka `/pay/<token>` di lebar 360px → konfirmasi pembayaran dari dashboard → refresh halaman publik berubah ke
`PAID` tanpa QR → cabut link → halaman publik berubah ke pesan generik → token ngawur → pesan generik yang sama.
Tulis hasil dan hal yang tidak sempat dites di `docs/v3/HANDOFF.md` bagian "Dari B ke A" (apa adanya, jangan dibagusin).

## Definition of done untukmu

Typecheck dan build hijau; semua state di atas terverifikasi manual; tidak ada file di luar `apps/web/**` yang berubah
(`git status` dibuktikan); tidak ada dependency baru; catatan handoff ditulis.
