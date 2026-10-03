# studenthub.id — Rencana Implementasi Backend Inti

## Context

Klien (medialab) meminta aplikasi **studenthub.id** sesuai deck PDF: platform manajemen sekolah
multi-sekolah dengan 4 peran — **Siswa** (app mobile), **Admin Sekolah**, **Sponsor**, **Super Admin**
(dashboard web). Repo `studenthub` masih kosong (hanya `New Text Document.txt`; remote
`github.com/sedotanbekas/studenthub`, branch `master`, **repo PUBLIC**). Fase ini **hanya core logic &
fungsi**: database, business rules, REST API, dokumentasi endpoint (OpenAPI + halaman `/docs`), test,
dan deploy + CI/CD. Tampilan dashboard & app Expo menyusul setelah klien follow-up.

Desain disusun oleh workflow 9 agen (1 skema terpadu, 5 desain domain, 3 reviewer adversarial:
keamanan, konsistensi, kelengkapan). Dokumen rincinya ada di scratchpad sesi
(`…\scratchpad\design\00-schema.md`, `01…05-*.md`, `review-*.md`) dan **disalin ke `docs/design/`
pada langkah pertama**. Bila dokumen desain bertentangan dengan rencana ini, **rencana ini yang berlaku**.

### Keputusan klien (final)
| Topik | Keputusan |
|---|---|
| Stack | Next.js 16 monolith + Prisma 7 (`@prisma/adapter-mariadb`) + MariaDB 10.11, zod v4, jose — pola LIMS |
| App siswa (nanti) | Expo React Native → Bearer token + refresh token + Expo push |
| Web (PWA) | manifest + `/sw.js`, Web Push VAPID ke **semua peran** (keputusan 2026-10-03, N3); iPhone: iOS 16.4+ dan "Tambah ke Layar Utama" dulu |
| Login siswa | NISN + password; wajib ganti password saat login pertama |
| Absensi | Check-in geofence + **selfie wajib**, Terlambat, Izin/Sakit (lampiran + approval), Alpha otomatis; tanpa absen pulang |
| Fake GPS | **Ditolak** (422) + percobaan dicatat untuk admin |
| Retensi selfie | **180 hari** (foto dihapus, catatan absensi tetap) |
| SPP | Admin buat tagihan; siswa unggah bukti; admin verifikasi; **cicilan/sebagian boleh** |
| Saldo PPC sponsor | Top-up manual + bukti transfer → Super Admin approve |
| Target iklan | Semua / provinsi / kota / sekolah tertentu |
| Deploy | VPS medialab + CI/CD GitHub Actions; **produksi `studenthub.id` + staging berisi data demo** |

### Fakta infrastruktur (terverifikasi read-only)
- VPS `38.47.176.211` (root via SSH key): Ubuntu 24.04, 8 core/15 GB/54 GB free, Node 24
  (`/www/server/nvm/versions/node/v24.18.1/bin`), PM2, nginx aaPanel, MariaDB 10.11 aaPanel
  (`/www/server/mysql`, :3306; login root tanpa password ditolak → pakai kredensial root aaPanel),
  Redis 127.0.0.1:6379, TZ server UTC, crontab root sudah dipakai app lain.
- Port terpakai: 3000–3003, 3010, 3012, 3013, 3020 (medtal), 3101 → **produksi :3030, staging :3031**.
- DNS `studenthub.id` belum ada.
- Lokal: Node 24, pnpm 10.15, Docker Desktop terpasang **tetapi daemon belum jalan**, `gh` login `sedotanbekas`.
- Data wilayah: `cahyadsn/wilayah` (MIT, Kepmendagri 300.2.2-2430 Th. 2025) → migrasi Province/City.

---

## Arsitektur & konvensi (resolusi konflik antar-desain)

**Dependensi:** next@16, react@19.2, @prisma/client + @prisma/adapter-mariadb@^7.8, zod@^4, zod-openapi
(v5/v6, OpenAPI 3.1), @scalar/nextjs-api-reference, jose@^6, **@node-rs/bcrypt** (native, async di luar
event loop — menggantikan bcryptjs), sharp@^0.34, file-type, exceljs, expo-server-sdk. Dev: prisma,
typescript, tsx, c8, @playwright/test, eslint + eslint-config-next@16, dotenv.

**Struktur** (file role per domain: `rules.ts` murni + test, `schemas.ts` zod, `dto.ts`, `service.ts`
mutasi `(input, ctx)`, `queries.ts` baca ber-`take`, `contracts.ts` kontrak route; `route.ts` ≤15 baris):
```
prisma/schema/{schema,auth,school,student,report-card,attendance,billing,notification,sponsor,platform}.prisma
src/instrumentation.ts            asersi boot (TZ=UTC, env, time_zone DB)
src/lib/{db.ts,env.ts,log.ts,tx.ts,audit.ts}
src/lib/http/*                    defineRoute, envelope, AppError, ERROR_CODES, pagination/cursor, body, client-ip, rate-limit
src/lib/openapi/*  src/lib/time/zone.ts  src/lib/storage/*  src/lib/jobs/*  src/lib/push/*
src/lib/{auth,schools,calendar,students,academics,report-cards,attendance,billing,announcements,notifications,sponsors,ads}/
src/app/api/v1/{auth,me,student,school,sponsor,platform,notifications,files,regions,meta}/**/route.ts
src/app/api/internal/jobs/[job]/route.ts   src/app/api/health/route.ts   src/app/docs/route.ts
tests/integration/**  e2e/**  scripts/**  docs/{design,openapi.json,deploy}/
```

**Satu versi untuk setiap blok bersama** (menggantikan 3–4 versi yang saling bertentangan di desain):
- `defineRoute(contract, handler)`: contract memuat `action` (dari `POLICY`), zod params/query/body,
  schema response, daftar error. Urutan: requestId → `getAuth` → `authorize(principal, action)` (role,
  status siswa/sponsor, gerbang `mustChangePassword`) → rate limit → zod → handler → envelope → log.
- Envelope `{success, data, error:{code,message,details,requestId}, meta}`; list = `data: T[]` +
  meta `{total,page,limit,totalPages}` (tabel admin) atau `{nextCursor,hasMore}` (feed).
- Satu `AppError(status, code, message, details)` + satu registry `ERROR_CODES`. Prisma P2002→409,
  P2025→404, P2034→409 setelah 3 retry, P2003→409, MariaDB errno 4025 (CHECK)→500 + log nama constraint.
  Log tidak pernah memuat `.message` Prisma/body/token (cegah bocor PII).
- `Principal` tunggal; `resolveSchoolScope(principal, ?schoolId)` → tipe bermerek `SchoolScope`:
  SCHOOL_ADMIN selalu sekolahnya sendiri (schoolId lain → 403); SUPER_ADMIN wajib `?schoolId` di
  `/school/*` (400 bila tidak ada). Lookup by id selalu `findFirst({id, schoolId})`; id tenant lain →
  **404**. Guard test melarang `findUnique({where:{id}})` pada model ber-schoolId.
- Satu `withTx` (retry P2034, timeout 20 s) + **urutan kunci global**: Student (id naik) →
  LeaveRequest → Attendance → ReportCard → Invoice → PaymentSubmission → Payment → DocumentCounter;
  terpisah: Sponsor → Ad/TopUpRequest → AdDailyStat; Notification & AuditLog selalu terakhir.
  **Tidak pernah** `FOR UPDATE` baris School/SchoolClass sebagai mutex (pakai klaim JobRun/baris kunci).
- Satu `writeAudit(tx, entry, ctx)` di transaksi yang sama; redaksi kunci `password|hash|token|secret`.
- Waktu: proses `TZ=UTC`, koneksi DB `initSql: SET time_zone='+00:00'`; modul murni `time/zone.ts`
  dengan offset tetap WIB+7/WITA+8/WIT+9; `@db.Date` = UTC-midnight. Tanggal lokal sekolah untuk
  absensi/izin/tagihan; WIB untuk analitik iklan. Dilarang `NOW()` di SQL mentah (pakai `ctx.now`).
- Path: `/auth/*`, `/me/*` (self lintas peran), `/student/*`, `/school/*`, `/sponsor/*`,
  `/platform/*` (super admin), `/notifications/*`, `/files/*`, `/regions/*`, `/meta/enums`.
- IP klien hanya dari `X-Real-IP` (app bind 127.0.0.1); IPv6 dinormalisasi ke /64 untuk kunci limiter.
- Satu proses PM2 **fork** (limiter/throttle in-memory; Redis nanti bila perlu cluster).
- Pesan error & dokumentasi Bahasa Indonesia; identifier kode Bahasa Inggris.

---

## Model data (satu migrasi init — belum ada produksi)

Skema dasar = `docs/design/00-schema.md`, **ditambah** perubahan yang disetujui:
- **auth**: `User` (role enum, email unik, `passwordHash`, `schoolId?`/`sponsorId?`, `isActive`,
  `mustChangePassword`, `tempPasswordExpiresAt`, TOTP super admin) — **tanpa `tokenVersion`**;
  `AuthSession` (per perangkat, `deviceId`, `expoPushToken @unique`, revoke reason); `RefreshToken`
  (hash SHA-256, `rotatedAt`); `WebPushSubscription` (satu per sesi WEB, endpoint unik lewat hash, N3).
- **school**: `Province`/`City` (seed migrasi), `School` (geofence, timezone, jadwal dalam menit lokal,
  mask hari sekolah, rekening SPP + `bankChangedAt`, `activeTermId @unique`), `Holiday` (per sekolah /
  nasional), `AcademicYear`, `Term`, `SchoolClass`, `Subject`, **`ClassSubject`**.
- **student**: `Student` (NISN, `activeNisn @unique` diklaim saat AKTIVASI, NIS, biodata wajib-aktivasi,
  status DRAFT/ACTIVE/INACTIVE/GRADUATED/MOVED, `currentClassId`, `activatedAt`, **`sppAmount?`**,
  `boundDeviceId`/`deviceBoundAt`).
- **report-card**: `ReportCard` (snapshot kelas, DRAFT/PUBLISHED, `sickDays/permitDays/absentDays`),
  `ReportCardGrade` (**score Int 0–100**, predikat, snapshot mapel & KKM).
- **attendance**: `Attendance` (unik siswa+tanggal, status, source, koordinat, jarak, mocked, deviceId,
  `selfieFileId`, `hasAnomaly` + `anomalyFlags`), **`CheckInRejection`** (koordinat dibulatkan 3
  desimal, dibuang bila >2 km), `LeaveRequest`.
- **billing**: `Invoice` (+`invoiceNo`, status UNPAID/PARTIAL/PAID/VOID, `paidAmount`),
  `PaymentSubmission` (+`pendingInvoiceId @unique` → maks 1 pending/tagihan), `Payment`
  (+`receiptNo`, `paidDate @db.Date`), **`DocumentCounter`** (nomor INV-/KWT- per sekolah per tahun).
- **notification**: `Announcement` (+`cancelledAt`), `AnnouncementTarget`, `Notification`
  (+`pushNextAttemptAt`, `pushAttempts`; enum tipe ditambah ATTENDANCE_CORRECTED, INVOICE_VOIDED,
  PAYMENT_VOIDED, NISN_RELEASED).
- **sponsor**: `Sponsor`, `Ad` (tanpa status ENDED — diturunkan dari `endAt`), `AdTarget`, `AdClick`
  (ClickBilling + **SUSPECT**), `AdDailyStat`, `SponsorLedgerEntry` (seq, balanceAfter),
  `TopUpRequest`.
- **platform**: `PlatformSetting` (CPC default Rp 500, min top-up Rp 100.000, rekening top-up,
  `deepLinkSchemes`), `StoredFile` (+`width/height`, `phash`, `attachedAt`, `deletedAt`, bucket
  privat/publik), `AuditLog`, `JobRun` (+`attempts`).
- **CHECK constraint** (MariaDB 10.11) di migrasi init untuk semua invarian di
  `review-consistency.md` §schema-merge (role/scope user, jadwal sekolah, status↔paidAmount, saldo ≥0,
  tanda ledger, target tepat satu kolom, dst.), masing-masing diuji di CI. Aturan enum-di-ujung &
  migrasi aditif berlaku setelah deploy produksi pertama.

---

## Aturan bisnis per domain (ringkas; detail di `docs/design/0x-*.md`)

**Auth & sesi** — `POST /auth/login {identifier, password, platform, deviceId?, expoPushToken?}`:
10 digit = NISN (hanya STUDENT), selain itu email (non-STUDENT); pesan gagal seragam + padding waktu.
Access JWT HS256 15 menit (`sub, sid`); refresh token opak dirotasi dengan deteksi reuse (grace 30 s);
sesi mobile maks 180 hari (idle 30 hari), sesi web 30 hari. Setiap request memverifikasi baris `AuthSession` (logout,
nonaktif, ganti password langsung berlaku). **Satu sesi mobile aktif per siswa** (login baru mencabut
yang lama); `deviceId` wajib untuk siswa. Limiter login: pasangan ip::identifier, identifier-saja, dan
IP; kunci aktif tak pernah di-evict. Kata sandi awal siswa **selalu di-generate**, kedaluwarsa 14 hari,
ditampilkan sekali. Kebijakan password (≥8, huruf+angka, tidak memuat NISN/NIS/tanggal lahir).
Transport cookie + CSRF untuk dashboard web **ditunda ke fase frontend** (arsitektur `Principal`
sudah siap). Endpoint: refresh, logout(-all), me, change-password, sessions, `PUT/DELETE /me/push-token`,
`GET /me/web-push` + `PUT/DELETE /me/web-push/subscription` (N3).

**Super admin & provisioning** (`/platform/*`): CRUD sekolah — **lokasi, geofence, timezone & rekening
bank sekolah hanya SUPER_ADMIN** (anti-geser geofence & anti-pengalihan rekening; diaudit + notifikasi
ke admin sekolah; `/student/payment-info` menandai "rekening berubah pada …" selama 14 hari). Admin
sekolah hanya mengubah jadwal/toleransi/hari sekolah via `PATCH /school/settings` (strictObject).
Buat akun admin sekolah & super admin, cari/nonaktifkan user (super admin terakhir tak bisa
dinonaktifkan), reset password, sponsor (create → PENDING/APPROVED/SUSPENDED), platform settings,
audit log, job runs, libur nasional. Super admin pertama via CLI `pnpm db:super-admin`.
**TOTP 2FA wajib untuk SUPER_ADMIN** (fase P5).
**Diubah pemilik 2026-10-02:** TOTP super admin DIMATIKAN sementara (env `SUPER_ADMIN_TOTP`, bawaan `off`;
rahasia yang terdaftar tetap tersimpan, nyalakan lagi = `on` + restart). Penggantinya **riwayat masuk super admin**
(`LoginEvent`, `GET /platform/login-history`, menu "Riwayat masuk"): setiap login berhasil & percobaan gagal mencatat
perangkat/browser (user-agent), id perangkat + penanda perangkat baru, IP, serta perkiraan kota/provinsi/negara & ISP
dari berkas DB-IP Lite lokal (`<STORAGE_ROOT>/geoip`, `pnpm geoip:update` di akhir setiap deploy, CC BY 4.0 → atribusi
"IP Geolocation by DB-IP" di halaman). Lokasi IP hanya perkiraan, bukan GPS.
**Akun admin untuk guru/wali kelas (pemilik 2026-10-02):** sementara belum ada peran guru, setiap guru/wali kelas
memakai akun ADMIN SEKOLAH TAMBAHAN miliknya sendiri (jangan berbagi akun). ADMIN UTAMA sekolah (login NPSN)
membuat & mengelola akun itu sendiri lewat `/school/admins*` (menu "Admin & guru": buat, ubah, nonaktif/aktifkan,
reset kata sandi, cabut sesi); admin tambahan hanya melihat daftar (`schoolAdmins.read`), kelola =
`schoolAdmins.manage` + `primarySchoolAdminOnly` (403 `PRIMARY_ADMIN_ONLY`). Admin utama sendiri hanya diubah super
admin (403 `PRIMARY_ADMIN_PROTECTED`); super admin cukup membuat admin utama. Batas 100 akun admin per sekolah.
Peran guru/wali kelas sungguhan (dibatasi per kelas) = fase berikutnya, menunggu jawaban sekolah.

**Siswa** (satu pemilik `src/lib/students`, `/school/students*`): create (default `activate=true`,
atomik, 422 + daftar kekurangan bila data wajib belum lengkap; `activate=false` → DRAFT), activate,
status transitions (tabel tunggal; MOVED melepas NISN & me-void tagihan masa depan), reset password,
hapus hanya DRAFT, pencarian nama/NIS/NISN + filter kelas + paginasi. Klaim NISN saat aktivasi; NISN
milik siswa LULUS di sekolah lain dilepas + audit di sekolah asal + notifikasi `NISN_RELEASED`.
**Impor XLSX/CSV** (≤1.000 baris, dry-run lalu commit, all-or-nothing, guard zip-bomb saat inflate).
**Kata sandi awal siswa (pemilik 2026-10-02):** semua siswa baru (tambah, impor) dan hasil reset admin memakai kata
sandi bawaan `studenthubid` (bukan acak lagi) agar mudah dibagikan; tetap wajib diganti saat masuk pertama, kedaluwarsa
14 hari, dan turunannya (`studenthubid1`, ...) ditolak kebijakan kata sandi.

**Kalender & akademik**: tahun ajaran, semester, semester aktif, kelas, mapel + pemetaan kelas–mapel,
**libur** `/school/holidays` (backdate ≤7 hari untuk admin sekolah) & `/platform/holidays` (nasional;
skrip impor libur nasional + cuti bersama 2026–2027). Setiap perubahan libur memanggil
`onCalendarChanged(tx)` di transaksi yang sama. Urutan onboarding terdokumentasi:
sekolah → tahun ajaran → semester aktif → kelas → mapel → siswa → libur.
Cek "kelas di tahun ajaran aktif" hanya saat aktivasi / ganti kelas (bukan tiap PATCH).

**Absensi** (`/student/attendance/*`, `/school/attendance/*`):
- `GET today` (hari sekolah?, jendela buka/terlambat/tutup, radius — **tanpa titik pusat geofence**).
- `POST precheck` (lokasi saja, tanpa selfie) → siswa tahu lolos/tidak sebelum memotret.
- `POST check-in` multipart (selfie JPEG/PNG/WebP + lat/lng/accuracy/mocked/locationTimestamp/
  clientTime/deviceId). Keputusan murni `decideCheckIn`: hari sekolah (mask + libur + dalam semester)
  → jendela `[open, close)` → mocked → **tolak**; umur fix >180 s tolak; akurasi >100 m tolak; jarak
  haversine ≤ radius + min(akurasi, 50 m). TERLAMBAT bila menit lokal > mulai + toleransi.
  Replay idempoten (CHECKIN ada → 200), bentrok ADMIN/AUTO_ALPHA → 409, baris LEAVE dikonversi.
  Selfie di-re-encode (640 px, EXIF dibuang) + dHash.
- Flag anomali v1 (tidak memblokir): GEOFENCE_TOLERANCE, LOW_ACCURACY, PERFECT_ACCURACY,
  DEVICE_SESSION_MISMATCH, STALE_FIX, CLOCK_SKEW, NEW_DEVICE, SHARED_DEVICE (sweep tutup hari),
  DUPLICATE_SELFIE (dHash vs selfie sendiri 60 hari).
- **Mode uji absensi (SEMENTARA, keputusan pemilik 2026-10-02)** untuk uji coba aplikasi: super admin membuka
  dan mengunci lewat `POST`/`DELETE /platform/attendance/test-mode` (halaman Pengaturan platform; diaudit;
  default terkunci). Selama terbuka, geofence serta jam & hari absen tidak diperiksa untuk SEMUA sekolah;
  (0,0), lokasi palsu, data basi, akurasi GPS, selfie, sesi HP, dan satu absen per hari tetap berlaku.
  Check-in yang lolos hanya karena mode ini diberi flag `TEST_MODE` (MEDIUM, tampil di antrean anomali admin sekolah). Dihapus setelah masa uji selesai.
- **Deteksi wajah opsional (pemilik 2026-10-02):** tombol foto di web tidak menunggu pendeteksi wajah (masih dimuat,
  gagal, atau belum menemukan wajah) agar absen tidak lama. Hasilnya dikirim sebagai `faceCheck` opsional
  (DETECTED / NOT_DETECTED / UNAVAILABLE); selain DETECTED diberi flag `FACE_NOT_DETECTED` (MEDIUM, antrean
  "Perlu ditinjau") untuk diperiksa manual admin sekolah — tidak pernah menolak absen. Selfie tetap wajib.
- **Alasan terlambat (pemilik 2026-10-03, A1):** siswa yang tercatat TERLAMBAT dari check-in sendiri boleh memberi
  alasan (6 kategori kode tetap — Transportasi/macet, Hujan/cuaca, Bangun kesiangan, Keperluan keluarga, Kurang sehat,
  Lainnya — + keterangan opsional ≤200 karakter, wajib ≥5 untuk Lainnya) di langkah tinjau absen, layar "tercatat",
  atau kartu Absensi, hanya untuk hari ini sebelum jam akhir hari sekolah (`PUT /student/attendance/today/late-reason`).
  Alasan TIDAK PERNAH menahan absen; server sendiri yang menentukan terlambat. Koreksi admin mengunci isian siswa
  (409) tanpa menghapus alasan; alasan dihitung selama status tetap TERLAMBAT. Admin melihatnya di detail catatan,
  daftar peta, Data Absensi, dan `GET /school/attendance/late-reasons` (per kategori; "belum diisi" = check-in sendiri
  tanpa alasan). Audit mencatat kategori & panjang keterangan (bukan teksnya). Tanpa notifikasi.
- **Konfirmasi identitas sebelum absen (pemilik 2026-10-03, A2):** alur absen web diawali kartu "Absen sebagai
  <nama> · <kelas> · NISN ••••<4 digit>". "Ya, ini saya" langsung meminta izin lokasi & kamera (tanpa ketukan tambahan),
  "Bukan saya" mengeluarkan akun dari perangkat itu (logout biasa) dan halaman masuk menjelaskan akibat masuk di HP
  pinjaman (akun di HP sendiri keluar; absen dua siswa dari HP yang sama ditandai `SHARED_DEVICE`). Hanya frontend,
  tanpa perubahan API; diingat per kunjungan halaman. Mencegah salah akun, bukan kecurangan yang disengaja.
- **Rekap bulanan + ekspor Excel (pemilik 2026-10-03, A3):** tab "Rekap bulanan" di Kehadiran: satu kelas satu
  bulan sebagai matriks siswa × tanggal (H/T/I/S/A, K = tercatat di kelas lain, L libur, ? hari belum ditutup,
  – tidak wajib absen, abu-abu = hari berjalan) + total per siswa (hadir, terlambat & menit, izin, sakit, alpa,
  % hadir, alasan terlambat A1). Kelas = snapshot saat absen dicatat (siswa pindah muncul di kedua kelas). Angka
  memakai SATU fungsi hitung dengan rekap kehadiran rapor & bulan siswa admin; hari belum ditutup ikut dihitung dan
  diberi peringatan. Unduh XLSX satu kelas atau semua kelas (sheet per kelas + Keterangan), diaudit, kuota 30 unduhan
  berhasil per 10 menit, tanpa NISN/foto/lokasi. Tanpa migrasi.
- **Tinjau anomali (pemilik 2026-10-03, B1):** admin sekolah (atau super admin dengan `?schoolId=`) menandai catatan
  beranomali (`hasAnomaly`, flag MEDIUM/HIGH) **Valid** (absensi tetap, catatan opsional) atau **Tidak valid** (jalur
  Koreksi absensi menjadi ALPHA: sumber ADMIN, alasan wajib ≥5 karakter yang dikirim ke siswa lewat
  `ATTENDANCE_CORRECTED`, jendela 45 hari untuk admin sekolah, bukan hari sekolah 422; bukti check-in & flag tidak
  pernah dihapus) lewat `POST /school/attendance/{id}/anomaly-review`. Satu audit `attendance.anomaly_review`. Body
  memuat flag yang dilihat admin; flag tersimpan berbeda → 409 `ANOMALY_FLAGS_CHANGED`. Tidak valid tidak bisa kembali
  ke Valid (409) — pemulihan lewat Koreksi absensi; **status yang berwenang**, keputusan hanya mencatat tinjauan.
  Flag `SHARED_DEVICE` baru (check-in siswa lain / sapuan tutup hari) membuka lagi tinjauan Valid. Antrean anomali
  default "Belum ditinjau" hari ini + 45 hari ke belakang; filter Valid / Tidak valid / Semua; `needsReview` di peta,
  daftar, Data Absensi (`anomaly=unreviewed`) dan legenda "N perlu ditinjau".
- Izin/Sakit: backdate ≤7 hari, maju ≤30, rentang ≤14; SAKIT ≥3 hari sekolah wajib lampiran foto;
  approve → baris IZIN/SAKIT tiap hari sekolah (tidak menimpa CHECKIN/ADMIN); reject wajib alasan.
- Auto-ALPHA per sekolah setelah `dayEndMinute` lokal (tiga zona waktu), catch-up 7 hari, idempoten
  via JobRun; koreksi admin (≤45 hari, alasan wajib, audit + notifikasi) + notifikasi Alpa ke siswa & rekap harian
  ke admin saat hari ditutup (N4, lihat Pengumuman & notifikasi).
- Monitoring: kartu hari ini, Data Absensi (filter status/BELUM_ABSEN/anomali), **Peta** (titik
  check-in + daftar `unlocated` untuk Izin/Sakit/Alpha/belum absen), Rekap Kelas, percobaan ditolak,
  anomali. Analitik: % per kelas per bulan, donat + selisih bulan lalu (poin persen), tren kelas &
  siswa. Verifikasi lokasi = haversine di server (Google Maps hanya untuk tampilan frontend nanti).

**Rapor** (`/school/report-cards/*`, `/student/report-cards`): nilai integer 0–100, predikat K13
relatif KKM (A: 3s ≥ KKM+200, B: 3s ≥ 2·KKM+100, C: s ≥ KKM), deskripsi; input massal per
kelas+mapel (all-or-nothing, error per baris); kesiapan → publish per kelas (lengkap semua mapel,
snapshot dibekukan, rekap sakit/izin/alpha dipotong di hari tertutup) → notifikasi; unpublish wajib
alasan. Siswa hanya melihat PUBLISHED.

**SPP** (`/school/invoices*`, `/school/payment-submissions*`, `/student/invoices*`): tagihan tunggal &
massal per bulan (dry-run, idempoten via slot unik siswa+periode, chunk 200, lewati siswa
`sppAmount=0`), nomor `INV-YYYY-NNNNNN`; edit/void/restore dengan aturan status; siswa unggah bukti
foto (maks 1 pending per tagihan, nominal ≤ sisa); approve (nominal disetujui, sebagian boleh →
PARTIAL) / reject beralasan; pembayaran tunai; void pembayaran; kuitansi `KWT-YYYY-NNNNNN`; status
tampilan (Belum Bayar, Sebagian, Menunggu Verifikasi, Jatuh Tempo, Lunas, Dibatalkan); bukti
near-duplikat (dHash) ditandai dalam sekolah yang sama.

**Pengumuman & notifikasi**: kategori pengumuman Akademik/Keuangan/Kegiatan/Kalender/Kesiswaan; audiens
semua / kelas / siswa tertentu; DRAFT → PUBLISHED (fan-out ke inbox per siswa) → CANCELLED (tarik);
pratinjau jumlah penerima. Inbox semua peran (`/notifications`, cursor, unread-count, read, read-all).
Satu jalur tulis `notify*(tx, …)` di dalam transaksi bisnis. Push ke **semua peran** lewat satu outbox
(`Notification.pushStatus`, dikirim via `after()` + tick, mutex in-process): Web Push VAPID (PWA, keputusan pemilik
2026-10-03, N3) dan Expo (app nanti; transport `log` sampai akun EAS siap); penerima tanpa perangkat → SKIPPED
NO_DEVICE; DeviceNotRegistered / 404-410 → token/langganan dihapus; langganan sesi yang dicabut ikut dihapus. Klik
notifikasi membuka bagian hub yang sesuai (+ ditandai dibaca). Ajakan "Aktifkan notifikasi" hanya di beranda HP /
aplikasi terpasang (tunda 7 hari); iPhone wajib iOS 16.4+ dan dibuka dari ikon layar utama (masuk ulang di aplikasi
itu; masuk lewat Safari lagi mengeluarkan aplikasi tersebut). Kunci VAPID dibuat sekali oleh deploy, tidak pernah
diganti. Web: satu poller badge unread-count per tab tetap berjalan (siswa 60 dtk; N1).
Admin sekolah boleh mematikan kategori kabar sekolah (Keuangan, Kesiswaan) untuk akunnya, dan admin utama juga untuk
akun admin tambahan (keputusan 2026-10-03, N2); hanya siaran ke admin yang disaring, saat ditulis. Notifikasi pribadi
& Sistem selalu dikirim; bila semua admin (yang pernah masuk) mematikan satu kategori, admin utama tetap menerimanya.
Saat hari sekolah ditutup (keputusan pemilik 2026-10-03, N4), di transaksi penutupan yang sama: siswa yang menjadi Alpa
(akun aktif yang pernah masuk, tanggal ≤ 3 hari lalu) menerima "Alpa pada <hari, tanggal>" dengan tombol ajukan
izin/sakit (atau teks "pengajuan … belum disetujui" bila ada izin PENDING), dan admin menerima satu rekap per hari
(≤ 1 hari lalu; Alpa/Terlambat/Izin/Sakit + "N perlu ditinjau"; dilewati bila tak ada Alpa/terlambat/anomali).
Kategori baru **Kehadiran** (ATTENDANCE) — rekap bisa dimatikan per akun admin seperti N2. Tanpa satu pun check-in
pada tanggal itu, notifikasi Alpa ke siswa ditahan dan rekap admin menyebutnya. Idempoten lewat `Notification.dedupKey`
(unik per penerima): tutup ulang tidak menggandakan; libur yang ditambah mundur menarik notifikasi tanggal itu.

**Sponsor & iklan** (`/sponsor/*`, `/platform/ads*`, `/platform/topups*`, `/student/ads*`):
PENDING boleh menyiapkan draft; hanya APPROVED yang bisa submit iklan & top-up; SUSPENDED read-only.
Banner diunggah terpisah (JPEG/PNG/WebP, rasio 2:1, ≥800 px → WebP 1200×600), **privat sampai iklan
disetujui**, lalu disalin ke bucket publik `/media`. Link: `https:` saja atau skema app dari allowlist
super admin; `javascript:/data:/intent:/http:` ditolak; host punycode ditandai untuk reviewer. Siklus:
DRAFT → PENDING_REVIEW (CPC di-snapshot saat submit) → APPROVED/REJECTED, pause/resume/archive,
takedown; ubah konten iklan aktif → review ulang. Penayangan: kandidat (approved, dalam jadwal, sponsor
approved, saldo ≥ CPC, target cocok) → rotasi deterministik per jam, maks 5 & maks 2 per sponsor,
token event bertanda tangan (6 jam, terikat siswa). Impresi batch (dedupe 30 menit). Klik: maks 1 klik
**ditagih** per siswa/iklan/hari WIB; **SUSPECT (tidak ditagih)** bila tak ada impresi 30 menit
sebelumnya atau siswa baru aktif <7 hari; potong saldo atomik (kunci baris Sponsor + ledger seq +
CHECK ≥0); notifikasi saldo menipis saat melewati ambang. Top-up (bukti foto) → approve CAS +
ledger; ADJUSTMENT oleh super admin (catatan + audit). Analitik: KPI + %perubahan vs periode
sebelumnya, deret harian 7d/30d/custom ≤92 hari (klik unik = COUNT DISTINCT), perangkat, provinsi,
tabel per iklan, top 3; kartu saldo "sisa … dari total top-up".

**Dashboard admin sekolah**: `GET /school/dashboard/summary` (total siswa aktif/nonaktif/draft,
kehadiran hari ini, rapor semester ini, siswa belum lunas + menunggu verifikasi).

**File & job**: unggahan bukti/selfie/lampiran = multipart inline di endpoint domain (atomik, tanpa
yatim); `GET /files/{id}` dengan `canReadFile` (404 bila tak berhak, 410 bila sudah dihapus
retensi); guard disk bebas <5 GB → 503; storage di luar repo. Satu baris cron per menit →
`POST /api/internal/jobs/tick` (header `X-Job-Secret`, 404 bila salah, tolak bila ada `X-Real-IP`;
nginx memblokir `/api/internal/`): push-dispatch, auto-alpha, orphan banner (per jam),
maintenance harian (cleanup sesi, purge selfie 180 hari, CheckInRejection 90 hari, retensi notifikasi).

### Ditunda (YAGNI — dicatat di backlog `docs/backlog.md`)
Cookie+CSRF web (fase dashboard) · penjadwalan/edit pengumuman terbit · kenaikan kelas massal
(sebelum Juli 2027) · unggahan PDF · push receipts & penggabungan notifikasi admin per pengajuan (rekap absensi harian sudah ada, N4) ·
IMPOSSIBLE_TRAVEL /
IDENTICAL_COORDINATES · tandai valid massal · ekspor PDF & rekap rentang bebas/semester · REFUND ledger · multi-user
sponsor · ringkasan platform iklan · job rekonsiliasi (diganti test invarian) · target jenjang sekolah ·
X-App-Version gate · sub-peran admin (bendahara/operator) · filter notifikasi per kelas guru · check-in offline · Play Integrity/App Attest.

---

## Fase implementasi (tiap fase teruji mandiri, sesuai roadmap F1–F4)

| Fase | Isi | Selesai bila |
|---|---|---|
| **P0 Fondasi** | Scaffold Next 16 + tooling (eslint max-lines 800, c8, playwright request-only); salin desain ke `docs/design`; `CLAUDE.md` repo; skema Prisma lengkap + migrasi init (CHECK, wilayah, PlatformSetting); `db.ts`/`env.ts`/instrumentation; pipeline HTTP, errors, pagination, time, tx, audit, limiter, storage, jobs tick, OpenAPI + `/docs` (Scalar, bundle dipin, Basic auth di prod); `/api/health` (sha); docker-compose MariaDB :3307; CI gate + workflow deploy; bootstrap VPS (user sistem `studenthub`, DB prod & staging, storage, PM2 fork :3030/:3031, nginx, cron) | Push ke master hijau, staging & produksi sehat menampilkan sha |
| **P1 (F1)** | Auth lengkap, super admin (sekolah, user, audit), sekolah/settings, kalender & akademik (tahun/semester/kelas/mapel/libur), siswa + aktivasi + impor, inbox notifikasi (baca), `db:seed:demo` | E2E: provisioning → siswa login NISN → wajib ganti password → `/auth/me`; suite IDOR 2 sekolah hijau |
| **P2 (F2a)** | Absensi: today/precheck/check-in/riwayat/ringkasan, izin/sakit, auto-ALPHA, koreksi, monitoring & peta, analitik, retensi selfie | E2E check-in → riwayat; izin disetujui → IZIN; auto-ALPHA idempoten WIB/WIT; analitik bulan seed tepat |
| **P3 (F2b)** | Rapor, SPP (tagihan, bukti, verifikasi, tunai, kuitansi), pengumuman + fan-out + push dispatcher, dashboard summary | E2E rapor terbit dibaca siswa; SPP massal → bukti → approve → LUNAS; pengumuman kelas hanya ke kelas itu |
| **P4 (F3)** | Sponsor, banner, iklan + review, penayangan/impresi/klik, ledger & top-up, analitik | E2E sponsor→iklan→top-up→tayang→klik→analitik & saldo; 20 klik paralel tak pernah overspend; saldo == ledger |
| **P5 (F4)** | TOTP super admin, job monitoring, hardening (security review penuh), coverage ≥80%, contoh OpenAPI + panduan integrasi Expo, drill backup/restore, SSL domain, go-live | Semua gate hijau, review tanpa CRITICAL/HIGH, produksi live di HTTPS |

## Strategi eksekusi (ultracode)
- **P0 dikerjakan berurutan** (fondasi bersama menentukan semua domain). Registry bersama dibuat per
  domain agar paralel tanpa konflik: `http/error-codes/<domain>.ts`, `auth/policy/<domain>.ts`,
  `notifications/templates/<domain>.ts`, `openapi` mengumpulkan `contracts.ts` tiap domain.
- **P1–P4**: satu Workflow per fase — agen implementasi per domain dengan kepemilikan folder terpisah,
  **TDD** (test aturan murni ditulis dulu → gagal → implementasi → hijau), lalu gate lokal
  (`typecheck`, `lint`, `test:unit`, `test:int`, `build`, `test:e2e`), lalu workflow review
  (code-reviewer + security-reviewer + typescript-reviewer, temuan diverifikasi adversarial) →
  perbaikan → commit.
- Git: kerja di branch `feat/p<N>-…`, commit Conventional Commits berbahasa Indonesia sebagai
  `sedotanbekas` **tanpa trailer atribusi**; merge/push ke `master` setelah gate hijau (push = deploy
  staging lalu produksi). Persetujuan rencana ini = izin push & deploy untuk fase-fase tersebut.

## Deploy & VPS
- **User sistem `studenthub`** (bukan root) memiliki `/www/wwwroot/studenthub{,-staging}` dan
  `/www/wwwroot/studenthub-storage{,-staging}`; PM2 milik user itu (fork, 1 instance, `TZ=UTC`,
  `next start -H 127.0.0.1 -p 3030/3031`) + startup systemd; nginx baca `public/` via grup.
- DB `studenthub` & `studenthub_staging` + user MariaDB masing-masing (password hex acak; dibuat
  dengan kredensial root aaPanel yang dibaca di VPS, tidak pernah dicetak/di-commit). `.env` chmod 600.
- nginx (vhost aaPanel + Let's Encrypt): `client_max_body_size 12m`, `X-Real-IP $remote_addr`,
  `location ^~ /api/internal/ {return 404;}`, `/media/` alias ke storage publik (immutable),
  proxy ke 127.0.0.1:3030 / :3031, `proxy_cache off`, HSTS.
- Cron `/etc/cron.d/studenthub` (flock, secret via file 600) memanggil tick prod & staging per menit;
  backup DB + storage harian (simpan 14) sebelum migrasi dan terjadwal.
- **GitHub Actions** (`master`): job `gate` (MariaDB 10.11 service: install frozen → typecheck → lint →
  openapi:check → unit → migrate DB kosong → integration → coverage ≥80% → build → e2e; tolak bila 0
  test) → `deploy-staging` (SSH user `studenthub`: fetch/reset, install frozen, guard nama DB, backup,
  migrate, `seed:demo`, build di bawah `flock` VPS-wide, `pm2 startOrReload`, poll health sampai sha
  cocok) → `deploy-production` (sama, tanpa seed demo). Concurrency tanpa cancel-in-progress.
  Secrets: `VPS_HOST`, `VPS_USERNAME`, `VPS_SSH_KEY` (deploy key ed25519 khusus, dibatasi
  no-port-forwarding) — di-set via `gh secret set`.

## Verifikasi
- Lokal: nyalakan Docker Desktop → `docker compose -f docker-compose.dev.yml up -d` (MariaDB :3307) →
  `pnpm db:migrate` → `pnpm test:unit` → `pnpm test:int` → `pnpm coverage` (≥80% lines/functions,
  ≥75% branches) → `pnpm build` → `pnpm test:e2e` (Playwright `request`, alur E2E per fase di tabel).
- Test wajib lintas fase: suite IDOR dua sekolah (404 lintas tenant, 403 salah peran), guard test
  (setiap route pakai `defineRoute` + action ada di POLICY; larangan `findUnique` by id; tak ada route
  di bawah `/api/v1/internal`; tak ada PII di log), satu test per CHECK constraint, roundtrip
  `@db.Date`/`time_zone`, konkurensi (check-in paralel, approve ganda, klik paralel, nomor dokumen
  tanpa celah).
- Setelah deploy: `curl https://…/api/health` menampilkan sha; buka `/docs` (Basic auth) di staging dan
  jalankan skenario demo: login NISN → ganti password → precheck → check-in dengan selfie contoh →
  peta admin → izin → approve → tagihan → unggah bukti → approve → sponsor → iklan → klik → analitik.
- Akhir tiap fase: workflow review (kualitas + keamanan + TypeScript) sampai tak ada CRITICAL/HIGH.

## Yang perlu Anda siapkan
1. **DNS**: A record `studenthub.id` dan `staging.studenthub.id` →
   `38.47.176.211` (sebelum itu app tetap jalan, hanya SSL & akses publik tertunda).
2. **Repo saat ini PUBLIC** — kode (bukan data/secret) terlihat publik; disarankan dijadikan private
   (deploy tetap jalan via deploy key read-only).
3. Push ke HP sudah lewat Web Push (PWA, N3; kunci dibuat otomatis saat deploy). Akun Expo/EAS hanya dibutuhkan bila
   app native dibuat.

## Default yang saya ambil (koreksi bila tidak sesuai)
Unggahan hanya foto (tanpa PDF) · satu HP = satu akun siswa aktif (HP bersama saudara → ditandai) ·
CPC awal Rp 500/klik, top-up min Rp 100.000 (bisa diubah super admin) · klik ditagih maks 1×/siswa/
iklan/hari · predikat rapor model K13 relatif KKM · nomor INV-/KWT-TAHUN-urut per sekolah · tanpa
denda keterlambatan SPP · siswa LULUS tetap bisa login read-only · lupa password → reset oleh admin
(tanpa email/WA OTP) · ~~sesi web admin 12 jam idle~~ → **login web tersimpan 30 hari** (permintaan klien
2026-09-28; sesi & refresh WEB 30 hari).
