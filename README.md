# Student Hub — API

Backend inti aplikasi **Student Hub**: platform manajemen sekolah multi-sekolah untuk 4 peran —
Siswa (app mobile Expo), Admin Sekolah, Sponsor, dan Super Admin (dashboard web).

- Rencana induk & keputusan klien: [`docs/PLAN.md`](docs/PLAN.md)
- Desain rinci per domain: [`docs/design/`](docs/design/)
- Kontrak API (OpenAPI 3.1): [`docs/openapi.json`](docs/openapi.json) — interaktif di `/docs`
- Aturan kerja repo (commit, migrasi, konvensi): [`CLAUDE.md`](CLAUDE.md)

## Stack
Next.js 16 (route handler) · Prisma 7 + MariaDB 10.11 · zod v4 · jose (JWT) · sharp · Node 24 · pnpm 10.

## Menjalankan lokal
```bash
pnpm install
cp .env.example .env                           # isi rahasia (openssl rand -base64 48)
docker compose -f docker-compose.dev.yml up -d # MariaDB 10.11 di 127.0.0.1:3307
pnpm db:migrate                                # skema + data wilayah + PlatformSetting
pnpm dev                                       # http://localhost:3030 — dokumentasi di /docs
```

## Test
| Perintah | Isi |
|---|---|
| `pnpm test:unit` | aturan murni (`src/**/*.test.ts`, node:test) |
| `pnpm test:int` | integrasi ke MariaDB `studenthub_test` (dibuat ulang otomatis) |
| `pnpm test:e2e` | E2E tingkat API (Playwright `request`) terhadap server berjalan |
| `pnpm coverage` | cakupan unit + integrasi (ambang 80%) |
| `pnpm typecheck` / `pnpm lint` | TypeScript & ESLint |

## Konvensi API
- Base path `/api/v1`, autentikasi `Authorization: Bearer <access token>`.
- Semua respons JSON: `{ success, data, error: { code, message, details, requestId }, meta }`.
- Tanggal lokal `YYYY-MM-DD` (zona sekolah; analitik iklan WIB), instant ISO UTC, uang = rupiah bulat.
- Data milik sekolah lain selalu dijawab **404**.

## Deploy
Push ke `master` → CI (gate) → staging → produksi (VPS, PM2 non-root). Lihat `docs/deploy/`.
