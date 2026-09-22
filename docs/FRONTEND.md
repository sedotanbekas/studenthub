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
| Siswa | Kehadiran dengan pemeriksaan lokasi dan selfie; izin/sakit; rapor; tagihan dan bukti transfer; kalender belajar; profil |
| Semua | Login; notifikasi; penggantian kata sandi; sesi perangkat; keluar. Pendaftaran dan konfirmasi TOTP khusus super admin |

Daftar mendukung filter, pencarian dan paginasi sesuai kemampuan endpoint. Tombol panah membuka detail dan tindakan terkait. **Pilih tampilan** berpindah antartampilan dalam satu modul; **Tindakan lainnya** menyediakan alur tambahan seperti impor siswa, tagihan massal, dan penerbitan rapor. Detail dan hasil tindakan dapat dicetak atau disimpan sebagai PDF melalui dialog cetak browser.

Impor siswa menyediakan pratinjau sebelum penyimpanan. Kata sandi sementara hasil pembuatan/reset ditampilkan pada hasil tindakan dan harus disimpan sebelum dialog ditutup. Kesalahan API ditampilkan sebagai kesalahan; aplikasi tidak menggantinya dengan data demo.

## Sesi web

- Browser berkomunikasi melalui `/api/web/*`. Proxy meneruskan permintaan ke `/api/v1/*` tanpa mengubah service domain.
- Access token dan refresh token disimpan di cookie `HttpOnly`, `SameSite=Lax`, dengan `Secure` di produksi. Token tidak dikembalikan ke JavaScript browser.
- Mutasi memerlukan origin yang sesuai. `Host` dan `X-Forwarded-Proto` mengikuti konfigurasi nginx.
- Proxy hanya meneruskan path/metode yang ada dalam kontrak, menuju loopback. `PORT` di konfigurasi PM2 membedakan produksi dan staging.
- API tetap menjadi sumber otorisasi, scope sekolah, validasi, dan audit.
- Portal siswa ini adalah web responsif. Aplikasi Expo native tetap merupakan aplikasi terpisah; browser tidak menyediakan deteksi mock GPS native. Pemeriksaan lokasi web mengirim informasi yang tersedia tanpa mengklaim kemampuan tersebut.

## Struktur dan pemeliharaan

- `src/components/hub/`: shell, dashboard, formulir, detail, kalender, lembar nilai, dan check-in.
- `src/app/globals.css`: identitas visual sage, ilustrasi CSS, layout responsif, dan aturan cetak.
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

Perubahan ini belum dipush atau dideploy; penerbitan dilakukan oleh pemilik proyek.
