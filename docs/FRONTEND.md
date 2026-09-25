# Frontend Student Hub

Frontend web responsif untuk admin sekolah, super admin, sponsor, dan siswa. Dibangun dengan Next.js App Router, React, dan CSS, menggunakan API serta aturan bisnis yang sudah ada.

## Menjalankan dan menjelajahi

```bash
pnpm dev
```

Buka `http://localhost:3030`. Masuk menggunakan akun yang tersedia, atau pilih **Jelajahi tampilan demo** untuk melihat data contoh tanpa mengubah database. Pemilih peran di banner demo dapat digunakan untuk mengeksplorasi navigasi setiap peran. Mode demo tidak menyimpan perubahan.

## Halaman

| Peran | Tampilan |
|---|---|
| Admin sekolah | Beranda dengan ringkasan dan grafik kehadiran; siswa; absensi dan izin; tahun ajaran, semester, kelas dan mapel; rapor dan lembar nilai; tagihan dan verifikasi pembayaran; pengumuman; kalender; profil sekolah; audit |
| Super admin | Sekolah; pengguna; sponsor; moderasi iklan; top-up; libur nasional; pengaturan platform; audit; seluruh halaman sekolah dengan pemilih sekolah |
| Sponsor | Kampanye, unggah banner dan target; analitik; saldo, top-up dan transaksi; profil perusahaan |
| Siswa | Beranda (kartu identitas + jam sekolah + status absen + menu besar + pengumuman); absensi dengan peta dan foto wajah; izin/sakit; rapor; tagihan dan bukti transfer; kalender belajar; profil |
| Semua | Login; notifikasi; penggantian kata sandi; sesi perangkat; keluar. Pendaftaran dan konfirmasi TOTP khusus super admin |

Daftar mendukung filter, pencarian dan paginasi sesuai kemampuan endpoint. Tombol panah membuka detail dan tindakan terkait. **Pilih tampilan** berpindah antartampilan dalam satu modul; **Tindakan lainnya** menyediakan alur tambahan seperti impor siswa, tagihan massal, dan penerbitan rapor. Detail dan hasil tindakan dapat dicetak atau disimpan sebagai PDF melalui dialog cetak browser.

Impor siswa menyediakan pratinjau sebelum penyimpanan. Kata sandi sementara hasil pembuatan/reset ditampilkan pada hasil tindakan dan harus disimpan sebelum dialog ditutup. Kesalahan API ditampilkan sebagai kesalahan; aplikasi tidak menggantinya dengan data demo.

## Sesi web

- Browser berkomunikasi melalui `/api/web/*`. Proxy meneruskan permintaan ke `/api/v1/*` tanpa mengubah service domain.
- Access token dan refresh token disimpan di cookie `HttpOnly`, `SameSite=Lax`, dengan `Secure` di produksi. Token tidak dikembalikan ke JavaScript browser.
- Mutasi memerlukan origin yang sesuai. `Host` dan `X-Forwarded-Proto` mengikuti konfigurasi nginx.
- Proxy hanya meneruskan path/metode yang ada dalam kontrak, menuju loopback. `PORT` di konfigurasi PM2 membedakan produksi dan staging.
- API tetap menjadi sumber otorisasi, scope sekolah, validasi, dan audit.
- Proxy meneruskan `User-Agent` browser agar server dapat mengenali browser HP (syarat absensi web).

## Absensi dari browser HP

Keputusan klien 2026-09-25: siswa boleh absen dari **browser HP** (bukan desktop), selain aplikasi Expo.

- **Perangkat absen.** Saat siswa masuk dengan NISN dari browser HP, frontend mengirim `deviceId` browser (`web-<uuid>` di localStorage). Server mengikat perangkat itu (`Student.boundDeviceId`) dan mencabut sesi perangkat absen lain milik siswa (app atau browser HP lain): satu perangkat absen aktif per siswa. Browser desktop dan sesi tanpa `deviceId` ditolak `403 CHECKIN_MOBILE_ONLY`; sesi lama cukup keluar lalu masuk ulang dari HP.
- **Lokasi & kamera wajib.** Alur absen (layar penuh) diawali layar izin; tidak bisa lanjut sebelum GPS dan kamera depan aktif. Bila izin dicabut, GPS dimatikan, atau kamera terputus di tengah alur, layar izin muncul lagi beserta langkah membuka izin di Chrome Android/Safari iPhone. Absensi butuh HTTPS.
- **Peta.** Leaflet + OpenStreetMap (tanpa API key) menampilkan area sekolah (titik + radius dari `GET /student/attendance/today`), posisi siswa, dan akurasi GPS. Pemeriksaan lokasi ke server (`precheck`) berjalan otomatis sekali setelah akurasi cukup, lalu manual (berbagi rate limit dengan check-in).
- **Foto wajah.** Hanya kamera depan langsung (tanpa unggah galeri). Deteksi wajah MediaPipe BlazeFace berjalan di perangkat; tombol foto aktif bila tepat satu wajah jelas, cukup dekat, dan di tengah bingkai. Pencocokan wajah dengan foto terdaftar belum termasuk (fase terpisah).
- **Batasan jujur.** Browser tidak melaporkan lokasi palsu seperti aplikasi, dan User-Agent dapat dipalsukan. Karena itu setiap absen web diberi flag anomali `WEB_CHECKIN` (LOW) agar admin tahu sumbernya; flag perangkat (`DEVICE_SESSION_MISMATCH`, `NEW_DEVICE`, `SHARED_DEVICE`), selfie duplikat, dan geofence server tetap berlaku.
- **Aset.** Runtime WASM MediaPipe (~12 MB/varian) disalin ke `public/vendor/mediapipe` oleh `scripts/vendor-mediapipe.mjs` saat `postinstall` dan `build` (tidak di-commit). Model `public/models/blaze_face_short_range.tflite` di-commit.
- **Demo.** Di mode demo, area sekolah disimulasikan di sekitar posisi pengguna dan pengiriman absen ditolak, sehingga seluruh alur bisa didemokan dari HP.

## Struktur dan pemeliharaan

- `src/components/hub/`: shell, dashboard, beranda siswa, formulir, detail, kalender, lembar nilai.
- `src/components/hub/attendance/`: halaman absensi, alur absen, izin perangkat, peta, kamera wajah.
- `src/lib/frontend/attendance.ts`: aturan murni alur absensi (verdict wajah, pesan izin, id perangkat, jam sekolah) + test.
- `src/app/globals.css` + `src/styles/{shell,content,student}.css`: sistem visual kontras tinggi (teks dasar 16px, satu warna aksen biru, warna status hanya untuk status).
- `src/lib/frontend/modules.ts`: susunan menu menurut peran.
- `src/lib/frontend/catalog.json`: kontrak formulir dan parameter yang diturunkan dari OpenAPI, bukan salinan business logic.
- `src/app/api/web/[...path]/route.ts`: transport sesi web.

Setelah kontrak API berubah:

```bash
pnpm openapi:export
pnpm frontend:sync
```

## Pemeriksaan

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm exec playwright install chromium
pnpm test:frontend
pnpm build
```

Browser tests terpisah dari E2E API dan menggunakan mock API untuk menguji interaksi, payload, error state, serta pembatasan antarmuka. Unit tests proxy memeriksa origin, cookie, token, multipart, batas unggahan, dan routing loopback. Pengujian browser tidak membuktikan seluruh mutasi terhadap database produksi.

Untuk instalasi Chromium yang sudah tersedia, `PLAYWRIGHT_CHROMIUM_EXECUTABLE` dapat menunjuk executable lokal. Screenshot akhir disimpan di `docs/frontend/screenshots/` dan memakai **data demo**, bukan data siswa nyata.

[Lihat galeri screenshot desktop dan mobile](frontend/screenshots/README.md). Untuk mengambil ulang screenshot dari server lokal yang berjalan, gunakan `node scripts/frontend-screenshots.mjs`.

