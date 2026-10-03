# Rencana integrasi adopsi HRIS (A1 → N5)

Ditulis 2026-10-03 setelah kritik adversarial semua spesifikasi (`*.critique.md`). Dokumen ini memutuskan hal yang
**lintas fitur**; keputusan per fitur ada di bagian "0. Revisi setelah kritik" di awal setiap spesifikasi. Urutan
berlaku: `docs/PLAN.md` > dokumen ini > bagian Revisi spesifikasi > isi draf spesifikasi.

## 1. Urutan & migrasi

| Urutan | Fitur | Migrasi | Isi skema |
|---|---|---|---|
| 1 | A1 alasan terlambat | `20261003010000_attendance_late_reason` | enum `LateReasonCategory`; 3 kolom `Attendance.lateReason*`; CHECK `chk_attendance_late_reason` |
| 2 | A2 konfirmasi identitas | — | frontend saja |
| 3 | B1 tinjau anomali | `20261003020000_attendance_anomaly_review` | enum `AnomalyReviewDecision`; 4 kolom + indeks + FK + CHECK `chk_attendance_anomaly_review` |
| 4 | A3 rekap bulanan | — | baca saja |
| 5 | N1 badge polling | — | frontend saja |
| 6 | N2 kategori notifikasi | `20261003030000_notification_mute` | tabel `NotificationMute`; CHECK `chk_notification_mute_category` |
| 7 | N4 notifikasi absensi | `20261003040000_attendance_notifications` | `NotificationType` += `ATTENDANCE_ALPHA`, `ATTENDANCE_DAY_SUMMARY`; `NotificationCategory` += `ATTENDANCE` (MODIFY `Notification`, `Announcement`, `NotificationMute`); `Notification.dedupKey` + unik `(userId, dedupKey)` |
| 8 | N3 Web Push | `20261003050000_web_push_subscription` | tabel `WebPushSubscription` |
| 9 | N5 pengingat absen | `20261003060000_attendance_reminder` | 2 kolom `School`; CHECK `chk_school_reminder_lead`; `Notification.pushExpiresAt`; `NotificationType` += `ATTENDANCE_REMINDER` |

- **Nilai enum di ujung.** Urutan akhir `NotificationType`: … `SCHOOL_SETTINGS_CHANGED`, `ATTENDANCE_ALPHA`,
  `ATTENDANCE_DAY_SUMMARY`, `ATTENDANCE_REMINDER`. Urutan akhir `NotificationCategory`: … `SYSTEM`, `ATTENDANCE`.
  Setiap `MODIFY` menyalin daftar PERSIS dari migrasi terakhir yang menyentuh kolom itu, lalu menambah di ujung.
- **CHECK baru wajib punya kasus** di `tests/integration/platform/check-cases.ts` (test `check-constraints` membandingkan
  daftar migrasi, tabel kasus, dan `information_schema`). Berlaku untuk A1, B1, N2, N5.
- **Migrasi yang menyalin tabel `Attendance`** (A1 & B1: `ADD CONSTRAINT`/FK memaksa ALGORITHM=COPY): merge ke `master`
  hanya di luar jendela absen semua zona, yaitu **03:00–20:00 UTC** (06:00 WIT = 21:00 UTC hari sebelumnya).

## 2. Keputusan lintas fitur

1. **Kategori notifikasi absensi (N2 × N4).** Kategori baru `ATTENDANCE` ("Kehadiran") ditambahkan oleh **N4** untuk
   `ATTENDANCE_ALPHA` dan `ATTENDANCE_DAY_SUMMARY` (dan `ATTENDANCE_REMINDER` di N5). `ATTENDANCE_CORRECTED` tetap
   STUDENT_AFFAIRS (baris lama sudah bercap). N2 tetap mengatur `FINANCE` + `STUDENT_AFFAIRS`; N4 menambahkan
   `ATTENDANCE` ke daftar kategori yang bisa dimatikan beserta petunjuknya. Kategori ini tidak ditawarkan untuk
   pengumuman (zod pengumuman membatasi pilihan).
2. **Satu definisi "perlu ditinjau" (B1 → N4, A3).** `PENDING_ANOMALY_REVIEW_WHERE = { hasAnomaly: true,
   anomalyReviewedAt: null }` diekspor dari `src/lib/attendance/anomaly-review-rules.ts`; N4 memakainya untuk hitungan
   "anomali perlu ditinjau" di rekap harian.
3. **Alasan terlambat (A1 → A3).** Hitungan kategori memakai `countLateReasons` yang sama: "diisi" = TERLAMBAT
   berkategori (sumber apa pun); "belum diisi" = check-in sendiri TERLAMBAT tanpa alasan. Alasan terkunci setelah
   jam akhir hari sekolah (`dayEndMinute`), sama dengan saat hari dianggap final oleh rekap bulanan.
4. **Koreksi & tinjau anomali (A1 × B1).** Baris bersumber `ADMIN` (koreksi atau "Tidak valid") mengunci alasan
   terlambat siswa (409 `LATE_REASON_LOCKED`). Pemeriksaan "flag berubah sejak dilihat" di B1 memakai daftar flag,
   **bukan** `updatedAt` (PUT alasan terlambat ikut mengubah `updatedAt`).
5. **Badge aplikasi (N1 × N3).** N1 hanya memperbarui badge di dalam halaman (tanpa `navigator.setAppBadge`). Badge
   ikon aplikasi milik service worker N3 (diset saat push tiba, dihapus saat halaman membaca 0 belum dibaca / keluar).
6. **Status push awal (N3 × N4 × N5).** N3 membuat semua peran `PENDING`; test N4 yang menyatakan baris admin
   `SKIPPED` diubah menjadi "PENDING atau SKIPPED NO_DEVICE". Pengingat N5 (`ATTENDANCE_REMINDER`) tetap PENDING.
7. **Tautan push (N3 × N4 × N5).** `webPathOf` mencakup layar baru: `attendance-alpha` → `/hub/my-leave`,
   `attendance-day` → `/hub/attendance`, admin `leave-request` → `/hub/leave-requests`, `check-in` →
   `/hub/my-attendance?absen=1`. Gerbang konfirmasi identitas A2 ada di dalam alur absen, jadi `?absen=1` ikut terjaga.
8. **Logout (A2 × N1 × N3).** Urutan di `logout(reason?)`: hentikan poller badge (N1) → mulai splash → panggil
   `/auth/logout` → lupakan langganan push browser (N3, tanpa menunggu) → `setMe(null)` + notice (A2).
9. **Dedup notifikasi job (N4 → N5).** N5 memakai `dedupKey` N4 (`attendance-reminder:<tanggal>`) untuk idempotensi per
   siswa per tanggal, bukan klausa `notifications none` sendiri.
10. **Penjaga katalog web.** `scripts/frontend-catalog.test.ts` (unit) memastikan `catalog.json` = operasi
    `docs/openapi.json`, jadi lupa `pnpm frontend:sync` langsung merah sebelum deploy.

## 3. Berkas yang disentuh banyak fitur

| Berkas | Fitur | Catatan |
|---|---|---|
| `src/lib/attendance/monitor-{schemas,dto}.ts`, `monitoring-queries.ts` | A1, B1, A3 | `monitoring-queries.ts` dekat batas 800 baris: kueri baru di berkas sendiri (`late-reason-queries.ts`, `anomaly-review-queries.ts`, `monthly-recap-queries.ts`) |
| `src/lib/frontend/demo-monitor.ts` | A1, B1, A3 | Data demo satu cerita: alasan terlambat (A1), tinjauan (B1), rekap (A3 di `demo-recap.ts`) |
| `src/components/hub/attendance/check-in-flow.tsx` | A1, A2 | A1: draf alasan + langkah tinjau/selesai; A2: kartu konfirmasi sebelum izin |
| `src/components/hub/use-session.ts`, `hub.tsx` | A2, N1, N3 | Lihat keputusan 8 |
| `src/lib/notifications/{notify,rules}.ts` | N2, N3, N4, N5 | N2 filter siaran admin; N4 `dedupKey`; N3 status awal; N5 `pushExpiresAt` & push-only |
| `src/lib/http/error-status.ts`, `rate-limits.ts`, `frontend/field-labels.ts` | semua | Kode error, limiter, dan label kunci respons wajib didaftarkan (dijaga test) |
| `tests/integration/platform/check-cases.ts` | A1, B1, N2, N5 | Satu kasus per CHECK baru |
| `docs/design/02-attendance.md` | A1, B1, A3, N4, N5 | Subbagian bernomor urut: §3.11 A1, §3.12 B1, §3.13 A3, §3.14 N4, §3.15 N5 |

## 4. Gerbang per fitur

`pnpm typecheck`, `pnpm lint` (0 error), `pnpm test:unit`, `TEST_DB_NO_RESET=1 pnpm test:int`, `pnpm openapi:check`,
`pnpm frontend:sync` bila kontrak berubah, `pnpm test:frontend` bila UI berubah, `pnpm test:e2e` bila route publik
berubah. Coverage CI: lines/functions/statements ≥ 80 %, branches ≥ 75 %.

## 5. Penerbitan

Sesi cloud ini mengikuti instruksi branch: semua fitur di-commit ke `feat/hris-adopsi` dan di-push ke branch itu.
**Merge ke `master` (= deploy produksi) diserahkan ke pemilik**, dengan memperhatikan jendela migrasi di §1.

### 5.1 Tinjauan risiko deploy (2026-10-03, PR sedotanbekas/studenthub#1)

Tinjauan multi-agen (6 dimensi, tiap temuan diverifikasi dua lensa: fakta kode & dampak produksi) sebelum merge.
Migrasi lolos (enum = prefiks persis + nilai di ujung, kolom baru nullable/ber-default, kode lama aman selama jendela
build, indeks unik aman untuk data lama). Diperbaiki di branch ini sebelum merge:

| Temuan | Perbaikan |
|---|---|
| A2/A1: `AbortSignal.timeout` melempar sinkron di Safari < 16 / Chrome < 103 → alur absen jatuh ke halaman galat | `timeoutSignal()` (`src/lib/frontend/timeout-signal.ts`) dengan cadangan AbortController |
| A3: "semua kelas" menghitung ulang SELURUH baris sekolah per kelas (O(kelas × baris)) di proses Node tunggal; kuota baru dihitung sesudah selesai sehingga permintaan paralel lolos semua | `partitionByClass` (bagi sekali, O(baris)), pengelompokan tanpa spread, benchmark mengukur jalur sesungguhnya; ekspor berjalan maks. 1 per akun & 2 per proses (429) |
| Rollback ke kode sebelum N4/N5 membuat kotak masuk & badge 500 bila sudah ada notifikasi ber-enum baru | Runbook "Rollback" di `docs/deploy/BOOTSTRAP.md` (DELETE per sha tujuan, segera setelah kode lama aktif) + komentar `remote-deploy.sh` + N4 §9 |
| `ensure_vapid_keys`: crash skrip (kode 1) dilaporkan sebagai kunci rusak → operator bisa menghapus kunci | Kode 2 = kunci tidak sah; kode lain = "skrip gagal, JANGAN ubah VAPID_*" |
| N3/N5: klik notifikasi memfokuskan tab beranda/dokumen tanpa berpindah; tujuan di halaman yang sama tidak menandai dibaca / tidak membuka alur absen | SW hanya memakai jendela `/hub` (selain itu jendela baru); `navigationKind` → muat penuh bila halaman sama |
| `docs/integration/expo.md` belum memuat screen baru | Daftar screen + aturan parsing toleran |

Tetap terbuka (bukan pemblokir, dicatat untuk pemilik): data terlambat sebelum A1 terhitung "belum diisi" di hitungan
alasan & rekap; isi lengkap notifikasi admin (mis. NISN pada NISN_RELEASED) tampil di layar kunci bila Web Push aktif
(default §10 N3); penahanan Alpa N4 gugur oleh satu check-in (termasuk mode uji); tab hub di layar masuk tidak
menerima navigasi klik notifikasi. Merge memakai fast-forward dari akun `sedotanbekas` (bukan tombol merge GitHub,
yang membuat commit/committer baru).
