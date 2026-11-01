# MVP V3 — Handoff antar agent

## Dari A (backend) ke B (frontend)

Status: backend selesai dan terverifikasi (lihat bagian Verifikasi di handover akhir). Kontrak: `docs/v3/CONTRACT.md`.
Untuk menguji frontend terhadap API nyata, set di `apps/api/.env`:

```bash
PUBLIC_BASE_URL=http://localhost:3100
PAYMENT_LINK_SECRET=<minimal 32 karakter>   # di non-production boleh kosong (dipakai secret dev)
```

Catatan penting:
- `GET /v1/invoices/:id/payment-link` mengembalikan `{ "link": null }` (200) kalau belum ada link, bukan 404.
- Respons `PaymentLinkView.url` hanya terisi saat `ACTIVE`.
- Halaman publik: abaikan perbedaan sebab (dicabut/ngawur); backend sengaja mengembalikan satu error yang sama.
- Rate limit publik 60/menit/IP: tombol "Perbarui status" jangan polling otomatis.

## Dari B ke A

(isi oleh Agent B: hasil verifikasi manual, hal yang tidak sempat dites, kekurangan kontrak)
