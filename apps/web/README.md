# Kirana Pay — Web (Next.js + TypeScript)

Dashboard baru dengan logo brand, tema terang/gelap, dan layout responsif
(sidebar di desktop, top bar + tab bar di mobile).

API Nest tetap jadi satu-satunya backend. Web app mem-proxy `/v1/*` ke API lewat
`rewrites` di `next.config.ts`, jadi cookie sesi tetap same-origin (tanpa CORS).

## Jalankan lokal

```bash
pnpm install                       # dari root repo (update pnpm-lock.yaml juga)
cd apps/api && pnpm start:dev      # terminal 1 → :3000
cd apps/web && cp .env.example .env.local && pnpm dev   # terminal 2 → :3100
```

Buka <http://localhost:3100>.

## Env

| Var | Default | Fungsi |
|---|---|---|
| `API_URL` | `http://localhost:3000` | Alamat API Nest untuk proxy `/v1/*` |

## Struktur

```text
app/            layout, globals.css (design system), page
components/     Dashboard, AuthView, GeneratorTab, QrisTab, SettingsTab, Logo, ...
lib/            api client, tipe, format rupiah, clipboard
public/brand/   mark.svg, wordmark.svg (hasil trace logo, ikut warna tema), favicon.svg
```

Dashboard lama (static) di `apps/api/public` masih ada dan tidak diubah.
