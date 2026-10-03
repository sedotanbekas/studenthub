# Serah-terima: adopsi ide HRIS ke studenthub.id (absensi → notifikasi)

Ditulis 2026-10-03 oleh sesi lokal sebelum laptop pemilik ditutup. Sesi berikutnya (mis. Claude di cloud)
melanjutkan dari dokumen ini. `CLAUDE.md` di root repo tetap berlaku penuh; dokumen ini menambah konteks
yang sebelumnya hanya tersimpan di memori sesi lokal.

## Keputusan pemilik (2026-10-03)

- Sumber inspirasi: HRIS Medialab terbaru = monorepo privat `medialabindonesia/mymedialab-apps`, folder
  `apps/hris` (bukan repo lama `hrismedialab`). Skema HRIS ada di `apps/hris/scripts/schema.sql`.
  Spesifikasi di folder ini menyebut path HRIS lokal lama (`.../scratchpad/mymedialab-apps/apps/hris`) —
  ganti dengan lokasi clone kalian. Clone di Windows butuh `git -c core.longpaths=true`.
- Pemilik menerima urutan dan meminta **seluruhnya dieksekusi**:
  1. Absensi: **A1** alasan terlambat → **A2** konfirmasi identitas sebelum absen → **B1** tinjau anomali
     (Valid/Tidak valid) → **A3** rekap bulanan per kelas + ekspor Excel.
  2. Notifikasi: **N1** badge diperbarui berkala → **N2** kategori notifikasi per akun admin → **N4**
     notifikasi peristiwa absensi → **N3** Web Push (PWA) → **N5** pengingat absen.
- B1 DISETUJUI walau `docs/PLAN.md` mencantumkan "workflow review anomali" di daftar Ditunda — perbarui
  PLAN.md & `docs/backlog.md` saat mengerjakannya (sebut persetujuan pemilik 2026-10-03).
- N3 DISETUJUI dengan syarat yang diterima pemilik: pengguna iPhone harus "Tambah ke Layar Utama" dulu
  agar bisa menerima push.

## Status saat serah-terima

- Belum ada kode fitur yang ditulis. Branch ini hanya berisi dokumen desain.
- Spesifikasi per fitur: `A1-late-reason.md`, `A2-identity-confirm.md`, `B1-anomaly-review.md`,
  `A3-monthly-recap-export.md`, `N1-badge-polling.md`, `N2-notification-categories.md`,
  `N4-attendance-notifications.md`, `N3-web-push.md`, `N5-attendance-reminders.md`.
- Spesifikasi adalah DRAF desainer. Alur aslinya: desain → kritik adversarial → revisi → rencana integrasi.
  Saat snapshot dibuat, hanya sebagian kritik yang selesai (`*.critique.md`); revisi & rencana integrasi
  (`00-integration.md`) mungkin belum ada. Bila berkasnya belum ada, **lakukan sendiri** sebelum
  mengimplementasi: verifikasi tiap klaim spesifikasi ke kode nyata (path:line), terapkan kritik yang valid,
  lalu cek benturan antar-fitur (urutan nilai enum, cap waktu migrasi, berkas bersama).
- Patokan gerbang di `master` (cf0e88b) secara lokal: typecheck & lint bersih, unit 1390/1390,
  integrasi 760/761 — satu gagal di `tests/integration/ads/ad-lifecycle.test.ts:233` karena data lama
  menumpuk di DB test yang tidak di-reset (pencarian sekolah target berhalaman); CI dengan DB baru hijau.

## Cara kerja per fitur (wajib, sesuai kebiasaan pemilik)

1. Branch `feat/<nama>` dari `master` terbaru. Baca spesifikasi + kritiknya. TDD: aturan murni di
   `rules.ts` + test `node:test` dulu, lalu service/kontrak/route, lalu UI + mode demo.
2. Gerbang lokal: `pnpm typecheck`, `pnpm lint` (0 error), `pnpm test:unit`,
   `TEST_DB_NO_RESET=1 pnpm test:int`, `pnpm openapi:check` (jalankan `pnpm openapi:export` setelah
   kontrak berubah), `pnpm frontend:sync` bila katalog berubah, dan `pnpm test:e2e` bila UI/alur berubah
   (butuh server di :3030 + DATABASE_URL). Coverage CI: lines/functions/statements ≥ 80%, branches ≥ 75%.
3. Review kode (kebenaran, tenancy/keamanan, konvensi CLAUDE.md, UX/demo) dan perbaiki temuan.
4. Commit (Conventional Commits Bahasa Indonesia, tanpa trailer asisten), fast-forward merge ke
   `master`, push, lalu pantau CI sampai selesai: `gh run watch <id> --exit-status` (gerbang → staging →
   produksi). Pemilik ingin ini dilakukan tanpa bertanya dulu, lalu dilaporkan hasilnya.
   **Push ke `master` = deploy produksi.** CI hanya berjalan untuk push ke `master`, jadi jangan merge
   sebelum gerbang lokal (termasuk `test:int`) hijau.

## Identitas & akses (penting)

- Commit: penulis & committer `sedotanbekas <rafifn.a18@gmail.com>` (`git config user.name/email`).
- Push HANYA dengan akun GitHub `sedotanbekas`. Sebelum push periksa `git config user.*` dan
  `gh auth status`; jangan pernah push dengan akun/token lain. Di sesi cloud: pastikan akun GitHub yang
  terhubung adalah `sedotanbekas`; bila bukan, berhenti di branch dan minta pemilik yang push/merge.
- Claude tidak punya akses SSH ke VPS. Langkah server diberikan ke pemilik sebagai skrip salin-tempel
  (Terminal aaPanel), atau dibuat otomatis lewat skrip deploy yang idempoten.

## Lingkungan lokal

- MariaDB dev/test: `docker compose -f docker-compose.dev.yml up -d` (port 3307, init
  `docker/mariadb-init.sql`). Tanpa Docker: pasang MariaDB 10.11, buat DB & user seperti
  `docker/mariadb-init.sql`, lalu isi `.env` dan `.env.test` dari `.env.example`
  (DB test harus berakhiran `_test`). Proses berjalan dengan `TZ=UTC`.
- `pnpm test:int` biasa menjalankan `prisma migrate reset`, yang DITOLAK Prisma 7 bila dijalankan agen AI
  tanpa persetujuan eksplisit pemilik. Pakai `TEST_DB_NO_RESET=1 pnpm test:int` (menjalankan
  `prisma migrate deploy`, cukup untuk migrasi aditif baru). Jangan memalsukan persetujuan.
- Migrasi ditulis tangan di `prisma/migrations/<YYYYMMDDHHMMSS>_<nama>/migration.sql` dengan komentar
  pembuka Bahasa Indonesia; aditif saja, nilai enum baru di UJUNG. Migrasi terakhir di master:
  `20261002100000_login_event`.
- Aplikasi lokal: `pnpm dev` (port 3030). Mode demo (persona simulasi di browser, `src/lib/frontend/demo*.ts`)
  harus tetap jalan untuk setiap endpoint baru yang dipanggil UI.

## Catatan N3 (Web Push) untuk server

Kunci VAPID harus ada di `.env` staging & produksi. Spesifikasi N3 merancang langkah deploy idempoten yang
membuat kunci bila belum ada (pakai node, jangan openssl). Bila tetap butuh tindakan manual, tuliskan
perintah salin-tempel untuk pemilik.

## Konteks produk singkat

- Hanya siswa yang absen (tanpa absen pulang), satu jadwal & satu geofence per sekolah. Peran: SUPER_ADMIN,
  SCHOOL_ADMIN (admin utama = `User.primarySchoolId`; akun admin tambahan dipakai guru/wali kelas), SPONSOR,
  STUDENT. Belum ada peran guru/orang tua.
- Mode uji absensi (platform, sementara) ada di `src/lib/attendance/test-mode.ts`; jangan dihapus tanpa
  perintah pemilik.
- Domain: produksi `studenthub.id`, staging `staging.studenthub.id`. Nama produk di UI: `studenthub.id`.
