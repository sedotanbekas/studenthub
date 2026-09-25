# Frontend Student Hub

Frontend web responsif untuk admin sekolah, super admin, sponsor, dan siswa. Dibangun dengan Next.js App Router, React, dan CSS, menggunakan API serta aturan bisnis yang sudah ada.

## Menjalankan dan menjelajahi

```bash
pnpm dev
```

Buka `http://localhost:3030`. Masuk menggunakan akun yang tersedia, atau pilih salah satu tombol **Coba tanpa login** di bawah form: Admin sekolah, tiga siswa (Alya belum absen, Bima sudah hadir, Citra terlambat), Sponsor, atau Super admin. Mode demo memakai data contoh di browser, tidak menyentuh database, dan tidak menyimpan perubahan; persona dapat diganti dari banner demo. Persona siswa hanya melihat data miliknya sendiri (rapor, tagihan, profil) dengan bentuk data yang sama seperti API siswa; jalur `/student/*` tanpa persona siswa selalu kosong.

## Halaman

| Peran | Tampilan |
|---|---|
| Admin sekolah | Beranda dengan ringkasan dan grafik kehadiran; siswa; absensi dan izin; tahun ajaran, semester, kelas dan mapel; rapor dan lembar nilai; tagihan dan verifikasi pembayaran; pengumuman; kalender; profil sekolah; **tema sekolah**; audit |
| Super admin | Sekolah; pengguna; sponsor; moderasi iklan; top-up; libur nasional; pengaturan platform; audit; seluruh halaman sekolah dengan pemilih sekolah |
| Sponsor | Kampanye, unggah banner dan target; analitik; saldo, top-up dan transaksi; profil perusahaan |
| Siswa | Beranda (kartu identitas + jam sekolah + status absen + menu besar + pengumuman); absensi dengan peta dan foto wajah; izin/sakit; rapor; tagihan dan bukti transfer; kalender belajar; profil |
| Semua | Login; notifikasi; penggantian kata sandi; sesi perangkat; keluar. Pendaftaran dan konfirmasi TOTP khusus super admin |

Daftar mendukung filter, pencarian dan paginasi sesuai kemampuan endpoint. Tombol panah membuka detail dan tindakan terkait. **Pilih tampilan** berpindah antartampilan dalam satu modul; **Tindakan lainnya** menyediakan alur tambahan seperti impor siswa, tagihan massal, dan penerbitan rapor. Detail dan hasil tindakan dapat dicetak atau disimpan sebagai PDF melalui dialog cetak browser; saat mencetak, hanya isi dialog yang tercetak. Detail rapor tampil sebagai dokumen rapor A4 (kop sekolah, identitas, nilai akhir + capaian kompetensi, ketidakhadiran, penandatangan). Format ini **asumsi awal** struktur umum Kurikulum Merdeka; kop, penandatangan, dan bagian tambahan per sekolah menunggu contoh rapor dari sekolah klien.

Impor siswa menyediakan pratinjau sebelum penyimpanan. Kata sandi sementara hasil pembuatan/reset ditampilkan pada hasil tindakan dan harus disimpan sebelum dialog ditutup. Kesalahan API ditampilkan sebagai kesalahan; aplikasi tidak menggantinya dengan data demo.

## Sesi web

- Browser berkomunikasi melalui `/api/web/*`. Proxy meneruskan permintaan ke `/api/v1/*` tanpa mengubah service domain.
- Access token dan refresh token disimpan di cookie `HttpOnly`, `SameSite=Lax`, dengan `Secure` di produksi. Token tidak dikembalikan ke JavaScript browser.
- Mutasi memerlukan origin yang sesuai. `Host` dan `X-Forwarded-Proto` mengikuti konfigurasi nginx.
- Proxy hanya meneruskan path/metode yang ada dalam kontrak, menuju loopback. `PORT` di konfigurasi PM2 membedakan produksi dan staging.
- API tetap menjadi sumber otorisasi, scope sekolah, validasi, dan audit.
- Proxy meneruskan `User-Agent` browser agar server dapat mengenali browser HP (syarat absensi web).
- `POST /auth/logout` selalu menghapus kedua cookie sesi, termasuk bila access token sudah tidak ada atau backend gagal.
- Kerangka hub (`app/hub/layout.tsx` → `HubShell`) bertahan antarhalaman; isi per bagian ada di `app/hub/[[...section]]/page.tsx`. Setiap pergantian identitas (masuk, keluar, masuk demo, ganti persona) mereset state dan tema, lalu membawa pengguna ke beranda bila halaman saat itu bukan milik perannya (`src/components/hub/use-session.ts`, `sectionAllowed`).

## Absensi dari browser HP

Keputusan klien 2026-09-25: siswa boleh absen dari **browser HP** (bukan desktop), selain aplikasi Expo.

- **Perangkat absen.** Saat siswa masuk dengan NISN dari browser HP, frontend mengirim `deviceId` browser (`web-<uuid>` di localStorage). Server mengikat perangkat itu (`Student.boundDeviceId`) dan mencabut sesi perangkat absen lain milik siswa (app atau browser HP lain): satu perangkat absen aktif per siswa. Browser desktop dan sesi tanpa `deviceId` ditolak `403 CHECKIN_MOBILE_ONLY`; sesi lama cukup keluar lalu masuk ulang dari HP.
- **Lokasi & kamera wajib.** Alur absen (layar penuh) diawali layar izin; tidak bisa lanjut sebelum GPS dan kamera depan aktif. Bila izin dicabut, GPS dimatikan, atau kamera terputus di tengah alur, layar izin muncul lagi beserta langkah membuka izin di Chrome Android/Safari iPhone. Absensi butuh HTTPS.
- **Peta.** Leaflet + OpenStreetMap (tanpa API key) menampilkan area sekolah (titik + radius dari `GET /student/attendance/today`), posisi siswa, dan akurasi GPS. Pemeriksaan lokasi ke server (`precheck`) berjalan otomatis sekali setelah akurasi cukup, lalu manual (berbagi rate limit dengan check-in).
- **Foto wajah.** Hanya kamera depan langsung (tanpa unggah galeri). Deteksi wajah MediaPipe BlazeFace berjalan di perangkat; tombol foto aktif bila tepat satu wajah jelas, cukup dekat, dan di tengah bingkai. Pencocokan wajah dengan foto terdaftar belum termasuk (fase terpisah).
- **Batasan jujur.** Browser tidak melaporkan lokasi palsu seperti aplikasi, dan User-Agent dapat dipalsukan. Karena itu setiap absen web diberi flag anomali `WEB_CHECKIN` (LOW) agar admin tahu sumbernya; flag perangkat (`DEVICE_SESSION_MISMATCH`, `NEW_DEVICE`, `SHARED_DEVICE`), selfie duplikat, dan geofence server tetap berlaku.
- **Aset.** Runtime WASM MediaPipe (~12 MB/varian) disalin ke `public/vendor/mediapipe` oleh `scripts/vendor-mediapipe.mjs` saat `postinstall` dan `build` (tidak di-commit). Model `public/models/blaze_face_short_range.tflite` di-commit.
- **Akurasi GPS.** Browser tidak bisa memaksa GPS menjadi akurat; akurasi ditentukan perangkat. Alur absen meminta akurasi tinggi, memantau terus dan memakai fix terbaik (`preferFix`), menunggu hingga 15 detik untuk fix yang memenuhi batas sebelum mengirim (`bestPosition`), dan menampilkan langkah sesuai perangkat bila lokasi masih perkiraan jaringan (Android: Akurasi Lokasi Google; iPhone: Lokasi Akurat; laptop: tidak ada GPS). Server tetap menolak fix yang kurang akurat.
- **Demo.** Di mode demo, area sekolah **dan akurasi GPS** disimulasikan di sekitar posisi pengguna dan pengiriman absen ditolak, sehingga seluruh alur bisa didemokan dari HP maupun laptop.

## Struktur dan pemeliharaan

- `src/components/hub/`: shell, dashboard, beranda siswa, formulir, detail, kalender, lembar nilai.
- `src/components/hub/attendance/`: halaman absensi, alur absen, izin perangkat, peta, kamera wajah.
- `src/lib/frontend/attendance.ts`: aturan murni alur absensi (verdict wajah, pesan izin, id perangkat, jam sekolah) + test.
- `src/app/globals.css` + `src/styles/{shell,content,student}.css`: token dan tata letak (teks dasar 16px, warna status sama untuk semua sekolah).
- `src/styles/glass.css`: material "liquid glass". Blur nyata hanya pada topbar, tab bar HP, laci navigasi HP, dialog, dan toast; kartu memakai kaca semu tanpa blur; tabel, formulir, dan isi dialog tetap padat. Tersedia cadangan untuk `prefers-reduced-transparency`, `prefers-contrast: more`, browser tanpa `backdrop-filter`, perangkat bermemori kecil (`data-glass="lite"`), dan sakelar **Tampilan kontras tinggi** di sidebar (`data-glass="off"`, per perangkat).
- `src/styles/transitions.css` + `page-transition.tsx` + `hub-link.tsx`: transisi halaman lewat React `<ViewTransition>`. Di layar ≤ 960px, membuka halaman menggeser halaman baru dari kanan ke kiri dan kembali menggeser dari kiri ke kanan (420 ms, ease-in-out); di desktop berupa pudar halus. `traverse-transitions.tsx` mencegat tombol kembali/maju browser karena Next 16.3 memulihkan riwayat tanpa View Transition (vercel/next.js#86881); uji ulang setiap upgrade Next.
- `src/styles/print.css`: cetak isi dialog saja; rapor sebagai A4.
- **Tema sekolah**: `src/lib/schools/theme-rules.ts` (aturan murni: warna, kontras WCAG, turunan token, 8 preset) → `src/lib/frontend/theme.ts` (`applyTheme` memasang token di `<html>` dan warna bilah browser) → halaman `theme-settings.tsx`. Tema dari `GET /auth/me` (`school.theme`), sehingga admin **dan siswa** sekolah itu melihat warna yang sama. Warna apa pun diterima; turunan tema menjaga teks tetap terbaca (≥ 4.5:1) dan editor memberi tahu bila warna disesuaikan otomatis. Di mode demo, tema disimpan per sesi browser.
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

