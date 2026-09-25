# Panduan integrasi aplikasi siswa (Expo)

Dokumen ini untuk pengembang aplikasi mobile siswa (Expo / React Native). Semua endpoint, field, dan
kode error di sini diambil dari kontrak route (`src/lib/**/contracts*.ts`) — sumber kebenaran yang
sama dengan `docs/openapi.json` dan halaman `/docs` (Scalar, dilindungi Basic auth). Bila dokumen ini
dan OpenAPI berbeda, **OpenAPI yang berlaku**.

- Base URL: `https://studenthub.medialab.co.id/api/v1` (produksi), `https://staging.studenthub.medialab.co.id/api/v1` (staging, data demo).
- Semua permintaan & respons JSON UTF-8, kecuali unggahan (multipart) dan unduhan berkas (biner).
- Waktu: instant selalu ISO 8601 UTC (`2026-09-21T01:30:00.000Z`); tanggal lokal sekolah `YYYY-MM-DD`;
  jam lokal `HH:mm`. **Tanggal & jam absensi ditentukan server**, bukan jam HP.

## 1. Envelope & error

Setiap respons JSON memakai envelope yang sama:

```json
{ "success": true,  "data": { }, "error": null, "meta": null }
{ "success": false, "data": null, "error": { "code": "OUTSIDE_GEOFENCE", "message": "…", "details": { "distanceM": 412, "radiusM": 150 }, "requestId": "…" }, "meta": null }
```

- Tampilkan `error.message` ke pengguna (Bahasa Indonesia, aman ditampilkan). Logika aplikasi
  bercabang pada `error.code`, **jangan** pada teks pesan.
- `error.details` opsional, bentuknya per kode (mis. `retryAfterSeconds`, `distanceM`, daftar field
  pada `VALIDATION_FAILED`).
- Header `X-Request-Id` ada di setiap respons (sama dengan `error.requestId`); sertakan saat melapor bug.
  Klien boleh mengirim `X-Request-Id` sendiri.
- Paginasi halaman: query `page` (1..), `limit` (1..100, default 20); `meta = {total, page, limit, totalPages}`.
- Paginasi cursor (inbox notifikasi): query `cursor`, `limit`; `meta = {limit, nextCursor, hasMore}`.

Kode umum yang harus ditangani di satu tempat (interceptor HTTP):

| Status | Kode | Tindakan aplikasi |
| --- | --- | --- |
| 400 | `VALIDATION_FAILED`, `INVALID_JSON`, `INVALID_MULTIPART` | Bug klien / input form; tampilkan pesan. |
| 401 | `TOKEN_EXPIRED` | Access token kedaluwarsa → jalankan refresh (§3) lalu ulangi permintaan sekali. |
| 401 | `UNAUTHENTICATED`, `SESSION_INVALID`, `ACCOUNT_INACTIVE` | Sesi berakhir (logout, dicabut, akun nonaktif) → hapus token, ke layar login. |
| 403 | `PASSWORD_CHANGE_REQUIRED` | Arahkan ke layar ganti kata sandi (§4). |
| 403 | `STUDENT_NOT_ACTIVE` | Siswa LULUS mencoba aksi tulis → mode baca-saja. |
| 403 | `CHECKIN_MOBILE_ONLY` | Sesi bukan ANDROID/IOS atau tanpa `deviceId` → login ulang dari aplikasi. |
| 404 | `NOT_FOUND` | Data tidak ada atau bukan milik siswa ini (server tidak membedakan). |
| 413 / 415 | `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `HEIC_NOT_SUPPORTED` | Kompres / konversi foto ke JPEG. |
| 429 | `RATE_LIMITED` (+ header `Retry-After` detik) | Tunda tombol sampai `Retry-After`. |
| 503 | `SERVICE_UNAVAILABLE` | Server sementara tidak menerima unggahan; coba lagi nanti. |

Daftar kode per endpoint ada di OpenAPI (`responses` → contoh per status).

## 2. Login siswa

`POST /auth/login`

```json
{
  "identifier": "0012345678",
  "password": "…",
  "platform": "ANDROID",
  "deviceId": "a1b2c3d4e5f60718",
  "deviceName": "Samsung A15",
  "expoPushToken": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"
}
```

- `identifier` tepat 10 digit = **NISN** (hanya akun siswa). Selain 10 digit dianggap email (akun staf).
- `platform`: `ANDROID` atau `IOS`. **`deviceId` wajib** untuk siswa di mobile (400 `DEVICE_ID_REQUIRED`),
  pola `[A-Za-z0-9._:-]{8,100}`. Pakai id stabil dari `expo-application`:
  `Application.getAndroidId()` (Android) / `await Application.getIosIdForVendorAsync()` (iOS).
  Kirim `deviceId` yang **sama** di check-in.
- `expoPushToken` opsional (hanya ANDROID/IOS); bisa juga dipasang belakangan (§11).
- Respons `data` (`AuthTokens`): `accessToken` (JWT 15 menit), `accessTokenExpiresAt`, `refreshToken`
  (opak), `refreshTokenExpiresAt`, `sessionId`, `user {id, name, role, schoolId, sponsorId}`,
  `mustChangePassword`.
- Simpan `refreshToken` di `expo-secure-store`; `accessToken` cukup di memori.
- **Satu HP aktif per siswa**: login mobile baru mencabut sesi mobile lama siswa itu (sesi lama akan
  mendapat 401 `SESSION_INVALID`). Sesi mobile berlaku maks 180 hari, idle 30 hari.
- Gagal: 401 `INVALID_CREDENTIALS` (pesan seragam, NISN salah atau kata sandi salah tidak dibedakan),
  403 `ACCOUNT_INACTIVE` (`details.reason`: `STUDENT_DRAFT`, `STUDENT_INACTIVE`, `STUDENT_MOVED`,
  `SCHOOL_INACTIVE`, `USER_INACTIVE`), 403 `TEMP_PASSWORD_EXPIRED` (kata sandi awal > 14 hari → minta
  reset ke sekolah), 429 `RATE_LIMITED`.
- Lupa kata sandi: tidak ada reset mandiri; admin sekolah mereset dan memberi kata sandi sementara.

Kirim `Authorization: Bearer <accessToken>` di setiap permintaan lain (kecuali login & refresh).

## 3. Refresh token (rotasi) & `REFRESH_RACE`

`POST /auth/refresh` body `{ "refreshToken": "…" }` — **tanpa** header Authorization. Respons sama
dengan login (pasangan token BARU). Refresh token dirotasi setiap dipakai: simpan yang baru segera.

Aturan penting:

1. **Satu refresh dalam satu waktu.** Bungkus refresh dengan mutex/promise tunggal; semua permintaan
   yang mendapat 401 `TOKEN_EXPIRED` menunggu promise yang sama.
2. **409 `REFRESH_RACE`**: token lama dipakai lagi ≤ 30 detik setelah dirotasi (mis. dua tab/aplikasi
   dibangunkan bersamaan, atau respons refresh sebelumnya hilang). Jangan logout: **baca ulang refresh
   token dari SecureStore** (mungkin sudah diganti oleh permintaan lain), lalu ulangi sekali. Bila token
   tersimpan masih sama, tunggu ±1 detik lalu ulangi.
3. Token lama dipakai lagi > 30 detik setelah rotasi = indikasi pencurian: seluruh sesi dicabut →
   401 `SESSION_INVALID` → ke layar login.
4. 401 `ACCOUNT_INACTIVE` / `SESSION_INVALID` → hapus token, ke layar login.
5. Refresh dibatasi 600 permintaan/menit per IP (cukup untuk satu sekolah di balik satu NAT).

Refresh proaktif ±60 detik sebelum `accessTokenExpiresAt` mengurangi 401 di tengah alur check-in.

## 4. Wajib ganti kata sandi (`mustChangePassword`)

Akun siswa baru dan akun yang direset admin memakai kata sandi sementara (kedaluwarsa 14 hari).
Selama `mustChangePassword = true` (dari respons login/refresh atau `GET /auth/me`), semua endpoint
selain berikut menjawab 403 `PASSWORD_CHANGE_REQUIRED`:
`GET /auth/me`, `POST /auth/change-password`, `POST /auth/logout`, `POST /auth/logout-all`,
`GET/DELETE /me/sessions…`, `PUT/DELETE /me/push-token`.

`POST /auth/change-password` `{ "currentPassword": "…", "newPassword": "…" }` → `{changed: true, otherSessionsRevoked}`.
Kebijakan: ≥ 8 karakter (maks 72 byte), huruf + angka, tidak memuat NISN/NIS/tanggal lahir, bukan
kata sandi umum (422 `PASSWORD_POLICY`), tidak sama dengan yang lama (422 `PASSWORD_REUSED`); kata
sandi lama salah 400 `CURRENT_PASSWORD_INVALID` (5×/15 menit → 429). Sesi saat ini tetap berlaku,
sesi lain dicabut; tidak perlu login ulang. 409 `PASSWORD_CHANGED_CONCURRENTLY` → muat ulang & coba lagi.

`GET /auth/me` → `user` (termasuk `mustChangePassword`), `school {id, name, timezone, theme}`,
`student {id, nisn, nis, status, className}`, `permissions` (aksi yang diizinkan saat ini — pakai untuk
menyembunyikan menu). Profil lengkap: `GET /student/profile`. Kalender bulanan:
`GET /student/calendar?month=YYYY-MM`.

**Tema sekolah** (`school.theme`, komponen `SchoolTheme`): `{preset, primaryColor, secondaryColor,
bannerColor, animationColor, logoColor, isCustom, updatedAt}`. Kelima warna SELALU terisi `#rrggbb`
huruf kecil (tema bawaan bila admin belum mengatur: `isCustom=false`, `preset="nusantara"`). Warna
dipilih bebas oleh admin sekolah (tanpa aturan kontras), jadi app wajib menurunkan warna teks yang
terbaca sendiri — samakan dengan web: `themeVariables()` di `src/lib/schools/theme-rules.ts` (primer =
tombol/tautan, sekunder = aksen/chip, banner = kartu identitas & header beranda, animasi = loader/transisi,
logo = latar lambang). Admin mengubah tema lewat `PUT /school/theme` (reset: `DELETE /school/theme`);
siswa menerimanya pada `GET /auth/me` berikutnya — muat ulang saat app kembali ke foreground.
`school` bernilai `null` untuk super admin & sponsor → pakai tema bawaan.

## 5. Absensi: today → precheck → check-in

Hanya sesi ANDROID/IOS dengan `deviceId` (lainnya 403 `CHECKIN_MOBILE_ONLY`), siswa ACTIVE.

**`GET /student/attendance/today`** — isi layar Absensi: `date`, `serverTime`, `timezone`
(`WIB/WITA/WIT`) + `ianaTimezone`, `schoolDay {isSchoolDay, reason, holidayName}`,
`window {opensAt, lateAfter, closesAt, state: BEFORE_OPEN|OPEN|CLOSED}`, `geofence {radiusM, maxAccuracyM}`
(titik pusat sekolah sengaja tidak dikirim), `record` (catatan hari ini atau null), `pendingLeave`,
`canCheckIn`, `blockReason` (`ALREADY_CHECKED_IN`, `ATTENDANCE_ALREADY_RECORDED`, `NOT_SCHOOL_DAY`,
`CHECKIN_NOT_OPEN`, `CHECKIN_CLOSED`).

**Lokasi** (`expo-location`): minta izin foreground, ambil `getCurrentPositionAsync({ accuracy: Accuracy.High })`.
Kirim `coords.latitude`, `coords.longitude`, `coords.accuracy`, `mocked` (Android: `location.mocked`;
iOS tidak menyediakan → jangan kirim), `locationTimestamp = location.timestamp`, `clientTime = Date.now()`.

**`POST /student/attendance/precheck`** (JSON) — jalankan sebelum membuka kamera:

```json
{ "latitude": -6.9147, "longitude": 107.6098, "accuracy": 12.5, "mocked": false,
  "locationTimestamp": 1790000000000, "clientTime": 1790000001000 }
```

Respons `{ok, reason, message, distanceM, radiusM, window, wouldBeLate}`. `ok=false` → tampilkan
`message`, jangan buka kamera. `reason` salah satu `blockReason` di atas atau penolakan lokasi (tabel
di bawah). Lokasi palsu (`MOCK_LOCATION`) **dicatat untuk admin** walau hanya precheck.

**`POST /student/attendance/check-in`** (multipart/form-data, maks ±5,25 MB). Semua field teks
berupa string:

| Field | Isi |
| --- | --- |
| `selfie` | Berkas JPEG/PNG/WebP, ≤ 5 MB, sisi terpendek ≥ 240 px (HEIC ditolak 415 → pakai `expo-image-manipulator` ke JPEG ±1080 px, kualitas 0.7). |
| `latitude`, `longitude` | Desimal, mis. `"-6.9147"` (tanpa notasi eksponen). |
| `accuracy` | Meter, opsional tetapi tanpa ini → 422 `GPS_ACCURACY_TOO_LOW`. |
| `mocked` | `"true"`/`"false"`, opsional (jangan kirim di iOS). |
| `locationTimestamp`, `clientTime` | Epoch milidetik (`"1790000000000"`). |
| `deviceId` | Sama dengan saat login. |

```ts
const form = new FormData();
form.append("selfie", { uri: photo.uri, name: "selfie.jpg", type: "image/jpeg" } as any);
form.append("latitude", String(loc.coords.latitude));
form.append("longitude", String(loc.coords.longitude));
if (loc.coords.accuracy != null) form.append("accuracy", String(loc.coords.accuracy));
if (Platform.OS === "android") form.append("mocked", String(Boolean(loc.mocked)));
form.append("locationTimestamp", String(Math.round(loc.timestamp)));
form.append("clientTime", String(Date.now()));
form.append("deviceId", deviceId);
await fetch(`${BASE}/student/attendance/check-in`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
```

Jangan set header `Content-Type` manual (boundary diisi otomatis). Field kosong (`""`) ditolak 400 —
lewati field opsional yang tidak ada nilainya.

Hasil: **201** tercatat baru; **200** `replayed: true` bila hari ini sudah tercatat (aman diulang saat
jaringan putus — selfie kedua dibuang). `data = {attendance {id, date, status HADIR|TERLAMBAT, lateMinutes,
checkInAt, checkInTimeLocal, distanceM, source}, replayed, message}`.

Penolakan (urutan pemeriksaan server):

| Kode | Arti | `details` |
| --- | --- | --- |
| 409 `ATTENDANCE_ALREADY_RECORDED` | Sudah ada catatan admin/Alpha otomatis hari ini | — |
| 422 `NOT_SCHOOL_DAY` | Libur / di luar semester / hari libur mingguan | `reason`, `holidayName` |
| 422 `CHECKIN_NOT_OPEN` / `CHECKIN_CLOSED` | Di luar jendela check-in | `opensAt` / `closedAt` |
| 422 `INVALID_LOCATION` | Koordinat (0,0) | — |
| 422 `MOCK_LOCATION` | `mocked = "true"` (lokasi palsu) — dicatat untuk admin | — |
| 422 `LOCATION_STALE` | Umur fix GPS > 180 detik → ambil lokasi baru | `fixAgeS` |
| 422 `GPS_ACCURACY_TOO_LOW` | Akurasi kosong atau > 100 m → minta pindah ke area terbuka | `accuracyM`, `maxAccuracyM` |
| 422 `OUTSIDE_GEOFENCE` | Jarak > radius + min(akurasi, 50 m) | `distanceM`, `radiusM` |
| 422 `IMAGE_UNREADABLE` / `IMAGE_TOO_SMALL` / `IMAGE_TOO_LARGE` | Foto rusak/kecil/besar | — |
| 409 `CONFLICT_RETRY` | Bentrokan sesaat → ulangi sekali | — |

Precheck + check-in berbagi limiter `CHECK_IN`: 10 permintaan / 10 menit per siswa.

Riwayat: `GET /student/attendance?month=YYYY-MM` (meta `{prevMonth, nextMonth}`, maks 24 bulan ke
belakang, 422 `MONTH_OUT_OF_RANGE`), ringkasan semester `GET /student/attendance/summary?termId=…`.
Siswa LULUS tetap bisa membaca riwayat.

## 6. Izin / sakit

- `GET /student/leave-requests?status=&page=&limit=` (terbaru dulu), `GET /student/leave-requests/{id}`.
- `POST /student/leave-requests` (multipart): `type` (`IZIN`/`SAKIT`), `startDate`, `endDate`
  (`YYYY-MM-DD` lokal sekolah), `reason` (teks), `attachment` (opsional; foto JPEG/PNG/WebP ≤ 8 MiB,
  **wajib** untuk SAKIT yang mencakup ≥ 3 hari sekolah → 422 `ATTACHMENT_REQUIRED`). 201 → `LeaveRequest`.
- Aturan: mulai paling awal hari ini − 7 (`LEAVE_BACKDATE_LIMIT`), rentang ≤ 14 hari (`LEAVE_TOO_LONG`),
  selesai ≤ hari ini + 30 (`LEAVE_ADVANCE_LIMIT`), harus memuat hari sekolah (`NO_SCHOOL_DAYS_IN_RANGE`),
  tidak beririsan dengan izin lain (409 `LEAVE_OVERLAP`), maks 5 pengajuan/hari (429 `LEAVE_DAILY_LIMIT`).
  Limiter unggahan `UPLOAD`: 30 / 10 menit per siswa (dipakai bersama bukti SPP).
- `POST /student/leave-requests/{id}/cancel` hanya saat PENDING (409 `LEAVE_NOT_PENDING`).
- Lampiran diunduh lewat `GET /files/{attachmentFileId}` dengan header Bearer (lihat §10).
- Keputusan admin tiba sebagai notifikasi (`screen: "leave-request"`).

## 7. Tagihan SPP & bukti transfer

- `GET /student/invoices?filter=OUTSTANDING|PAID|ALL&page=&limit=` — `meta.summary` = total sisa tagihan.
- `GET /student/invoices/{id}` — detail + pembayaran + bukti + rekening sekolah.
- `GET /student/payment-info` — rekening SPP sekolah. Bila `bankRecentlyChanged = true` (14 hari sejak
  rekening diubah super admin) **tampilkan peringatan** sebelum siswa mentransfer.
- `POST /student/invoices/{id}/submissions` (multipart): `amount` (rupiah bulat tanpa pemisah, mis.
  `"150000"`; ≤ sisa dan ≥ min(sisa, 10.000)), `transferDate` (`YYYY-MM-DD`, hari ini − 90 .. hari ini),
  `senderName`, `senderBank`, `note` (opsional), `file` (foto bukti JPEG/PNG/WebP ≤ 8 MiB). 201 → ringkasan
  pengajuan (PENDING). Error: 409 `INVOICE_NOT_PAYABLE`, 409 `SUBMISSION_PENDING` (maks satu bukti menunggu
  per tagihan), 429 `TOO_MANY_SUBMISSIONS` (5/tagihan/hari), 422 `AMOUNT_EXCEEDS_REMAINING`,
  `AMOUNT_TOO_SMALL`, `PARTIAL_NOT_ALLOWED`, `TRANSFER_DATE_OUT_OF_RANGE`, error unggahan §1.
- `POST /student/payment-submissions/{id}/cancel` saat PENDING (409 `SUBMISSION_NOT_PENDING`).
- `GET /student/payments/{id}/receipt` — kuitansi (`voided = true` bila pembayaran dibatalkan).
- Hasil verifikasi & tagihan baru tiba sebagai notifikasi (`screen: "invoice"` / `"invoices"`).

## 8. Rapor

`GET /student/report-cards` (hanya yang sudah terbit, semester terbaru dulu) dan
`GET /student/report-cards/{id}` (nilai, KKM, predikat, deskripsi, rekap sakit/izin/alpha — snapshot
saat terbit). Terbit baru → notifikasi `screen: "report-card"`.

## 9. Pengumuman & inbox notifikasi

Pengumuman sekolah tidak punya endpoint siswa tersendiri: pengumuman terbit masuk inbox setiap siswa
sasaran sebagai notifikasi (`announcementId` terisi).

- `GET /notifications?kind=all|announcement|personal&category=&unreadOnly=true|false&cursor=&limit=` —
  feed terbaru dulu; lanjutkan dengan `cursor = meta.nextCursor` selama `meta.hasMore`. Beranda
  "Pemberitahuan" memakai `kind=announcement`, tab Notifikasi `kind=all`.
- Item: `{id, type, category, title, body (pratinjau ≤ 500), data {screen, id, count?} | null,
  announcementId, readAt, createdAt}`.
- `GET /notifications/{id}` — detail (isi pengumuman lengkap); tidak menandai dibaca. Pengumuman yang
  ditarik → 404 (hapus dari daftar lokal).
- `POST /notifications/{id}/read` (idempoten), `POST /notifications/read-all` `{before?, kind?}` —
  kirim `before` = waktu daftar diambil agar notifikasi yang baru tiba tidak ikut tertandai.
- `GET /notifications/unread-count` untuk badge.
- Navigasi dari `data.screen`: `announcement`, `attendance`, `leave-request`, `invoice`, `invoices`
  (id = periode `YYYY-MM`), `report-card`, `notification` (default). Payload push memuat
  `{notificationId, screen, id}` yang sama — saat push dibuka, navigasi lalu panggil `/read`.

## 10. Berkas privat

`GET /files/{id}` mengembalikan byte berkas (bukan envelope JSON) dan butuh header Bearer — pakai
`<Image source={{ uri, headers: { Authorization: … } }} />` atau `FileSystem.downloadAsync(uri, path, { headers })`.
Siswa hanya bisa membuka berkas unggahannya sendiri; lainnya 404. Selfie dihapus retensi setelah 180
hari → 410 `FILE_PURGED`. Banner iklan (`imageUrl`) adalah URL publik `/media/…` tanpa header.

## 11. Token push Expo

- Dapatkan token: `Notifications.getExpoPushTokenAsync({ projectId })` (butuh izin notifikasi).
- Pasang saat login (`expoPushToken`) atau `PUT /me/push-token` `{ "expoPushToken": "ExponentPushToken[…]" }`
  → `{registered: true}`. Panggil ulang setiap token berubah (`addPushTokenListener`). Format salah →
  422 `PUSH_TOKEN_INVALID`; sesi WEB → 422 `PUSH_TOKEN_WEB_SESSION`.
- Satu token hanya milik satu sesi aktif: bila HP yang sama login akun lain, token dipindahkan.
- `DELETE /me/push-token` → `{removed: true}` saat pengguna mematikan notifikasi. Logout
  (`POST /auth/logout`) otomatis menghapus token sesi itu.
- Push hanya salinan inbox: bila push gagal/ditolak, notifikasi tetap ada di `/notifications`.

## 12. Iklan slider (sponsor)

Hanya siswa ACTIVE.

1. `GET /student/ads` → `{ads: [{token, adId, title, imageUrl, targetUrl, linkType EXTERNAL_URL|DEEP_LINK,
   sponsorName}], refreshAfterSeconds}`. Maks 5 iklan (maks 2 per sponsor), rotasi per jam. Muat ulang
   setelah `refreshAfterSeconds`. `token` berlaku 6 jam dan terikat siswa ini — jangan dibagikan/di-cache
   lintas akun.
2. Impresi: saat slide **benar-benar terlihat** (≥ 50% di layar), kumpulkan token lalu kirim batch
   `POST /student/ads/impressions` `{ "events": [{ "token": "…" }] }` (1–20 per permintaan; limiter
   30/menit per siswa). Respons `{accepted, duplicate, rejected}` — impresi yang sama dalam 30 menit
   dihitung `duplicate` (tidak perlu dedup di klien secara ketat). Impresi tidak pernah ditagih.
3. Klik: `POST /student/ads/clicks` `{ "token": "…", "deviceType": "PHONE" }` — `deviceType` dari
   `expo-device`: `Device.deviceType` dipetakan ke nama enum (`PHONE`, `TABLET`, `DESKTOP`, `TV`, `UNKNOWN`;
   server menormalkan PHONE/UNKNOWN → MOBILE, TV → DESKTOP; default MOBILE). Respons `{targetUrl, linkType}`:
   buka `targetUrl` **dari respons ini** (`Linking.openURL`), bukan dari data slider; `targetUrl = null` →
   iklan sudah tidak tayang, jangan buka apa pun. Limiter 10 klik/menit; token siswa lain/kedaluwarsa →
   403 `AD_TOKEN_INVALID` (muat ulang slider); 404 `AD_NOT_FOUND`.

```ts
import * as Device from "expo-device";
const deviceType = Device.DeviceType[Device.deviceType ?? Device.DeviceType.UNKNOWN]; // "PHONE" | "TABLET" | …
```

## 13. Sesi & logout

- `POST /auth/logout` — cabut sesi ini (token push ikut dihapus). `POST /auth/logout-all` — semua perangkat.
- `GET /me/sessions` / `DELETE /me/sessions/{id}` — daftar & cabut sesi lain milik sendiri.

## 14. Ringkasan batas laju

| Limiter | Batas | Endpoint | Kunci |
| --- | --- | --- | --- |
| Login pasangan IP+NISN | 8 gagal / 10 menit (kunci 15 menit) | `/auth/login` | IP + identifier |
| Login per NISN | 10 gagal / 15 menit (kunci 15 menit) | `/auth/login` | identifier |
| Login per IP | 200 gagal / 10 menit | `/auth/login` | IP (NAT sekolah) |
| `REFRESH_IP` | 600 / menit | `/auth/refresh` | IP |
| `CHANGE_PASSWORD` | 5 kata sandi lama salah / 15 menit | `/auth/change-password` | akun |
| `CHECK_IN` | 10 / 10 menit | precheck + check-in | siswa |
| `UPLOAD` | 30 / 10 menit | izin + bukti SPP | siswa |
| `AD_IMPRESSION` | 30 / menit | `/student/ads/impressions` | siswa |
| `AD_CLICK` | 10 / menit | `/student/ads/clicks` | siswa |

Semua 429 membawa `Retry-After` (detik) dan `error.details.retryAfterSeconds`. Login hanya menghitung
**kegagalan**; login berhasil mengembalikan slotnya.

## 15. Checklist QA aplikasi

- [ ] Interceptor: `TOKEN_EXPIRED` → refresh tunggal → ulangi; `REFRESH_RACE` → baca ulang SecureStore.
- [ ] Login pertama → wajib ganti kata sandi → menu terbuka tanpa login ulang.
- [ ] Check-in: precheck dulu, foto dikompres JPEG, ulang kirim aman (200 `replayed`).
- [ ] Lokasi palsu di Android menampilkan pesan penolakan (tidak ada jalan pintas di klien).
- [ ] Unggahan izin & bukti SPP menangani 413/415/422 gambar.
- [ ] Push dibuka → navigasi sesuai `screen` → `/notifications/{id}/read`.
- [ ] Slider: impresi hanya saat terlihat, klik membuka `targetUrl` dari respons klik.
