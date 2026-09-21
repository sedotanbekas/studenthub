# Aturan kerja repo Student Hub

Rencana induk: `docs/PLAN.md` (disetujui klien 2026-09-21). Dokumen desain rinci per domain ada di
`docs/design/`; bila bertentangan dengan `docs/PLAN.md`, **PLAN yang berlaku**.

## Identitas commit — tanpa jejak asisten
- Penulis & committer: `sedotanbekas <rafifn.a18@gmail.com>`.
- **Jangan** menambahkan trailer `Co-Authored-By:`, `Claude-Session:`, atau tautan sesi apa pun.
- Conventional Commits berbahasa Indonesia: `feat`, `fix`, `chore`, `test`, `docs`, `refactor`, `perf`, `ci`.

## Deploy
- Push ke `master` = CI (gate) → deploy **staging** → deploy **produksi** di VPS. Perlakukan setiap
  merge ke `master` sebagai penerbitan. Kerjakan di branch `feat/...`, merge setelah gate hijau.
- Sebelum push: `pnpm typecheck`, `pnpm lint` (0 error), `pnpm test:unit`, `pnpm test:int` harus bersih.

## Konvensi kode
- Identifier Bahasa Inggris; pesan error, komentar, dan dokumen Bahasa Indonesia.
- Route handler hanya lewat `defineRoute(contract, handler)`; setiap contract punya `action` di POLICY.
- Data ber-`schoolId` selalu diambil lewat `SchoolScope` (`findFirst({ id, schoolId })`), id tenant
  lain → 404. Dilarang `findUnique({ where: { id } })` pada model ber-schoolId.
- Mutasi di `withTx`, ikuti urutan kunci global di `src/lib/tx.ts`; audit & notifikasi di transaksi yang sama.
- Waktu: proses `TZ=UTC`; tanggal lokal lewat `src/lib/time/zone.ts`; dilarang `NOW()` di SQL mentah.
- Aturan murni (tanpa Prisma) di `rules.ts` + test `node:test` di sebelahnya; tulis test dulu (TDD).
- Berkas < 800 baris, fungsi < 50 baris, tanpa `console.*` kecuali `src/lib/log.ts` & `scripts/`.

## Basis data
- Sebelum deploy produksi pertama: migrasi init boleh direvisi. **Setelah produksi berjalan:**
  migrasi selalu aditif (nol DROP/MODIFY/RENAME/TRUNCATE pada tabel terpakai) dan nilai enum baru
  ditambahkan di UJUNG daftar.
- Data referensi yang dibutuhkan produksi (wilayah, PlatformSetting) masuk migrasi, bukan seed.
