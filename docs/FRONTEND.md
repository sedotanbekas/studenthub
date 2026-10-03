# Frontend studenthub.id

Frontend web responsif untuk admin sekolah, super admin, sponsor, dan siswa. Dibangun dengan Next.js App Router, React, dan CSS, menggunakan API serta aturan bisnis yang sudah ada.

## Menjalankan dan menjelajahi

```bash
pnpm dev
```

Buka `http://localhost:3030`. Masuk menggunakan akun yang tersedia, atau pilih salah satu tombol **Coba tanpa login** di bawah form: Admin sekolah, tiga siswa (Alya belum absen, Bima sudah hadir, Citra terlambat dan belum mengisi alasan), Sponsor, atau Super admin. Mode demo memakai data contoh di browser, tidak menyentuh database, dan tidak menyimpan perubahan; persona dapat diganti dari banner demo. Persona siswa hanya melihat data miliknya sendiri (rapor, tagihan, profil) dengan bentuk data yang sama seperti API siswa; jalur `/student/*` tanpa persona siswa selalu kosong.

## Halaman

| Peran | Tampilan |
|---|---|
| Admin sekolah | Beranda dengan ringkasan dan grafik kehadiran; siswa; absensi dan izin; tahun ajaran, semester, kelas dan mapel; rapor dan lembar nilai; tagihan dan verifikasi pembayaran; pengumuman; kalender; profil sekolah; **tema sekolah**; audit |
| Super admin | Sekolah; pengguna; sponsor; moderasi iklan; top-up; libur nasional; pengaturan platform; audit; seluruh halaman sekolah dengan pemilih sekolah |
| Sponsor | Kampanye, unggah banner dan target; analitik; saldo, top-up dan transaksi; profil perusahaan |
| Siswa | Beranda (kartu identitas + jam sekolah + status absen + menu besar + pengumuman); absensi dengan peta dan foto wajah; izin/sakit; rapor; tagihan dan bukti transfer; kalender belajar; profil |
| Semua | Login; notifikasi; penggantian kata sandi; sesi perangkat; keluar. Pendaftaran dan konfirmasi TOTP khusus super admin |

Daftar mendukung filter, pencarian dan paginasi sesuai kemampuan endpoint. Klik baris (atau tombol panah) untuk membuka detail beserta tindakan per baris (ubah, nonaktifkan, setujui, dan sebagainya); tindakan per baris tidak lagi muncul di tingkat halaman. Tampilan dalam satu modul dipilih lewat **tab** (mis. Tagihan | Bukti transfer). Tombol biru selalu menyebut objeknya ("Siswa baru", "Tagihan baru"); tindakan tingkat halaman lain tampil sebagai tombol sekunder (maks. 2, mis. "Impor dari Excel"), sisanya di menu **Lainnya** yang menjelaskan tiap tindakan dalam satu kalimat. Teks tombol, nama tab, dan kolom pilihan diatur di `src/lib/frontend/workspace-rules.ts`; label kolom di `src/lib/frontend/field-labels.ts` (dijaga test). Halaman Akademik memakai halaman khusus dengan panduan (wizard). Detail dan hasil tindakan dapat dicetak atau disimpan sebagai PDF melalui dialog cetak browser; saat mencetak, hanya isi dialog yang tercetak. Detail rapor tampil sebagai dokumen rapor A4 (kop sekolah, identitas, nilai akhir + capaian kompetensi, ketidakhadiran, penandatangan). Format ini **asumsi awal** struktur umum Kurikulum Merdeka; kop, penandatangan, dan bagian tambahan per sekolah menunggu contoh rapor dari sekolah klien.

Impor siswa menyediakan pratinjau sebelum penyimpanan. Kata sandi sementara hasil pembuatan/reset ditampilkan pada hasil tindakan dan harus disimpan sebelum dialog ditutup. Kesalahan API ditampilkan sebagai kesalahan; aplikasi tidak menggantinya dengan data demo.

## Panduan (wizard) dan kartu persiapan

Tindakan yang berlangkah dibuka sebagai wizard di dalam dialog, bukan formulir generik (`src/components/hub/wizards/registry.tsx`): **Impor siswa** (templat → unggah & periksa → simpan → kata sandi awal, unduh CSV/cetak), **Tagihan SPP massal** (periode & nominal → penerima → pratinjau dry-run → terbitkan), **Rapor** (semester & kelas → mapel kelas → isi nilai per mapel → terbitkan yang lengkap), dan **Daftarkan sekolah** untuk super admin (identitas & jenjang → wilayah + titik di peta OpenStreetMap yang melompat ke ibu kota provinsi → rekening SPP → admin utama). Setiap langkah memuat satu kalimat sebab-akibat; tautan "formulir lengkap" tetap membuka formulir generik untuk kebutuhan lanjutan. Aturan murninya di `src/lib/frontend/wizard-rules.ts`.

- Langkah yang hasilnya sudah tersimpan terkunci (mis. setelah impor tersimpan, sekolah sudah dibuat) agar tidak tersimpan ganda atau berubah diam-diam.
- Menutup wizard yang akan menghilangkan sesuatu (kata sandi sekali tampil belum diunduh/dicetak, akun admin utama belum dibuat) memunculkan peringatan di dalam dialog lebih dulu (`useCloseGuard`).
- Semua `<dialog>` hanya menutup oleh `cancel` miliknya sendiri (Esc): `cancel` dari pemilih berkas yang dibatalkan ikut menggelembung dan dulu menutup formulir (`src/lib/frontend/dialog-events.ts`).
- Mode demo membaca data contoh dan menolak penyimpanan dengan pesan jelas. Pengecualian yang disimulasikan di memori halaman (hilang saat dimuat ulang): alasan terlambat siswa (A1) dan tinjau anomali admin (B1).

Beranda admin sekolah menampilkan kartu **Siapkan sekolahmu** (akademik, jam absensi, siswa, libur, rekening) selama langkah wajib belum selesai, plus pemberitahuan semester bila siswa belum bisa absen hari ini. Beranda sponsor baru menampilkan langkah persetujuan → saldo → kampanye → tayang. Keduanya hilang sendiri setelah selesai (`src/lib/frontend/onboarding-rules.ts`).

## Sesi web

- Browser berkomunikasi melalui `/api/web/*`. Proxy meneruskan permintaan ke `/api/v1/*` tanpa mengubah service domain.
- Access token dan refresh token disimpan di cookie `HttpOnly`, `SameSite=Lax`, dengan `Secure` di produksi. Token tidak dikembalikan ke JavaScript browser. Login web tersimpan 30 hari (cookie refresh token persisten, bertahan walau browser ditutup); access token 15 menit diperbarui otomatis.
- Mutasi memerlukan origin yang sesuai. `Host` dan `X-Forwarded-Proto` mengikuti konfigurasi nginx.
- Proxy hanya meneruskan path/metode yang ada dalam kontrak, menuju loopback. `PORT` di konfigurasi PM2 membedakan produksi dan staging.
- API tetap menjadi sumber otorisasi, scope sekolah, validasi, dan audit.
- Proxy meneruskan `User-Agent` browser agar server dapat mengenali browser HP (syarat absensi web).
- `POST /auth/logout` selalu menghapus kedua cookie sesi, termasuk bila access token sudah tidak ada atau backend gagal.
- Kerangka hub (`app/hub/layout.tsx` → `HubShell`) bertahan antarhalaman; isi per bagian ada di `app/hub/[[...section]]/page.tsx`. Setiap pergantian identitas (masuk, keluar, masuk demo, ganti persona) mereset state dan tema, lalu membawa pengguna ke beranda bila halaman saat itu bukan milik perannya (`src/components/hub/use-session.ts`, `sectionAllowed`).

## Data siswa: keluarga & kontak

Permintaan klien 2026-09-29. Data siswa memuat **alamat, nomor HP siswa, data ayah & ibu (nama, pekerjaan, nomor HP), dan wali** (kontak utama sekolah: nama, pekerjaan, nomor HP).

- Formulir tambah/edit siswa, detail siswa (admin), dan **Profil saya** (siswa, baca-saja) menampilkan semuanya; pekerjaan diisi bebas dengan saran pilihan (datalist dari `x-suggestions` OpenAPI, `OCCUPATION_SUGGESTIONS` di `src/lib/students/family.ts`).
- Semua data keluarga **opsional** — syarat aktivasi tetap nama & HP wali (kontak utama). Nomor HP diterima berawalan 08/62/+62 dan disimpan `+628…`.
- Impor Excel: templat punya kolom No HP Siswa, Nama/Pekerjaan/No HP Ayah, Nama/Pekerjaan/No HP Ibu, dan Pekerjaan Wali; templat lama tanpa kolom ini tetap diterima.

## Splash screen & sesi kerja

Permintaan klien 2026-09-28. Login web tersimpan **30 hari** (sesi & refresh token WEB 30 hari, cookie ikut kedaluwarsa refresh token).

- **Kapan tampil.** Hanya untuk yang **sudah masuk** (akun atau demo): saat situs dibuka lagi setelah terakhir dipakai **lebih dari 5 menit** lalu (walau hanya lebih 1 detik), dan saat kembali ke tab/aplikasi setelah pergi lebih dari 5 menit (juga bila perangkat tidur dengan tab terbuka). Kembali ≤ 5 menit: tanpa splash. **Tamu tidak pernah melihat splash saat membuka situs** (keputusan pemilik 2026-09-29, demi PageSpeed 100): halaman masuk langsung ada di HTML server. "Terakhir terlihat" (`studenthub_presence`) dicatat di `localStorage` setiap 15 detik selama tab terlihat, saat tab disembunyikan, dan saat halaman ditutup — bersama semua tab.
- **Animasi (≤ 1 detik).** Intro 540 ms: logo StudentHub (S + toga, bergaya stiker berbingkai putih) mekar dengan pegas, rumbai toga berayun seperti bandul, cincin & kilau tiga warna, tulisan "StudentHub" naik huruf demi huruf. Reveal 460 ms: logo **menjadi masker** — lubang berbentuk siluet logo menyusut sedikit lalu membesar dari titik terdalamnya sampai menutup layar ("masuk ke dalam logo") dan menyingkap halaman. Warna mengikuti tema sekolah terakhir (dibekukan saat splash mulai). Bila data belum siap setelah intro, logo menunggu (bernapas pelan), paling lama 8 detik.
- **Yang disingkap = halaman terakhir.** Halaman & posisi gulir terakhir akun (`studenthub_resume`: id user, path `/hub/...`, posisi, waktu) disimpan saat pindah halaman, tiap detak, dan saat tab disembunyikan/ditutup. Saat identitas akun diketahui (situs dibuka lagi / login ulang setelah sesi habis) dan pintu masuknya `/hub`, halaman itu dilanjutkan sebelum masker dibuka; tautan langsung ke halaman lain dihormati. Hanya akun yang sama, bagian yang boleh untuk perannya, maksimal 30 hari; bukan untuk mode demo dan akun wajib ganti sandi/TOTP. **Keluar** menghapus catatan ini.
- **Setelah login.** Tirai warna sekolah melingkar dari tombol yang ditekan (Masuk atau tombol demo) 420 ms sambil logo mekar, identitas baru dipasang setelah tirai menutup layar, lalu masker yang sama menyingkap beranda (total ≤ 1 detik). Login gagal setelah tirai mulai → splash memudar.
- **Keluar = masuk dibalik (3-2-1).** Permintaan pemilik 2026-09-29. Close 460 ms: lubang berbentuk logo menyempit dari layar penuh sampai seukuran logo lalu logo terisi (cermin reveal) → hold 120 ms: logo utuh, rumbai berayun, kilau muncul → unwipe 420 ms: tirai menyusut kembali ke **tombol Masuk** sambil logo mengecil, menyingkap halaman masuk. Keluar berlaku seketika (penyimpanan demo & halaman terakhir dihapus, sesi dicabut); hanya pergantian tampilan yang menunggu layar tertutup, dan tirai baru menyusut setelah alamat kembali ke `/hub`.
- **Tanpa kedip.** Keputusan saat halaman dimuat dijalankan skrip boot sebaris di `app/hub/layout.tsx` sebelum isi hub dilukis (`splashBoot` di `src/lib/frontend/splash-rules.ts`, diserialisasi `toString()` sehingga wajib mandiri). Splash kembali-ke-tab dan login dipasang di top layer (Popover API) agar menutupi dialog modal yang sedang terbuka. Pengaman: splash tersembunyi sendiri setelah 10 detik bila skrip aplikasi gagal. `prefers-reduced-motion`: logo statis tanpa zoom; splash kembali-ke-tab dan tirai login dilewati.
- **Kinerja halaman masuk (PageSpeed).** Server merender halaman masuk untuk tamu berdasarkan cookie **penanda** tanpa rahasia (`studenthub_session` dipasang/dihapus proxy `/api/web` bersama token; `studenthub_demo` untuk mode demo — `src/lib/frontend/session-hint.ts`); ada penanda → "Memuat…" lalu `GET /auth/me`. Tamu tidak memanggil `/auth/me`/`/auth/refresh` (tanpa galat 401/400 di konsol); sesi lama tanpa penanda dideteksi lewat `GET /api/web/session` (selalu 200). Isi bagian hub dimuat terpisah (`src/components/hub/sections.ts`, ±100 KB gzip) saat sesi diketahui / mulai mengetik / mengarah ke tombol demo. Tombol Masuk baru bertipe submit setelah hidrasi (kredensial tak pernah terkirim sebagai form biasa); ketukan tombol demo sebelum JS aktif dicatat lalu dijalankan (`src/lib/frontend/early-demo.ts`). Gambar splash di-preload hanya untuk yang punya penanda sesi; tamu memanaskannya setelah halaman dimuat.
- **Berkas.** Aset logo splash: `public/brand/splash-{body,tassel,shape}.webp` (dari `scripts/brand-assets.mjs`); aturan murni + test: `src/lib/frontend/splash-rules.ts`; pelaksana DOM: `src/components/hub/splash.ts`; markup: `splash-screen.tsx`; sambungan kerangka hub: `use-splash.ts`; gaya: `src/styles/splash.css`; uji browser: `tests/browser/splash.spec.ts`.

## Absensi dari browser HP

Keputusan klien 2026-09-25: siswa boleh absen dari **browser HP** (bukan desktop), selain aplikasi Expo.

- **Perangkat absen.** Saat siswa masuk dengan NISN dari browser HP, frontend mengirim `deviceId` browser (`web-<uuid>` di localStorage). Server mengikat perangkat itu (`Student.boundDeviceId`) dan mencabut sesi perangkat absen lain milik siswa (app atau browser HP lain): satu perangkat absen aktif per siswa. Browser desktop dan sesi tanpa `deviceId` ditolak `403 CHECKIN_MOBILE_ONLY`; sesi lama cukup keluar lalu masuk ulang dari HP.
- **Konfirmasi akun (A2).** Alur absen diawali kartu "Absen sebagai <nama>" dengan kelas & NISN tersamar 4 digit terakhir (dari `GET /student/profile`, batas tunggu 5 detik; gagal = nama saja). "Ya, ini saya" langsung meminta izin lokasi & kamera; "Bukan saya" menutup alur lalu keluar, dan halaman masuk menampilkan penjelasan (bila server tidak terjangkau: "Akun belum keluar sepenuhnya… sambungkan internet lalu muat ulang"). Konfirmasi diingat selama kunjungan halaman per akun (muat ulang/ganti persona = tanya lagi). Pintasan `?absen=1` ikut terjaga karena gerbang ada di dalam alur. Aturan murni: `src/lib/frontend/identity-confirm-rules.ts`.
- **Lokasi & kamera wajib.** Setelah konfirmasi akun, alur absen (layar penuh) menampilkan layar izin; tidak bisa lanjut sebelum GPS dan kamera depan aktif. Bila izin dicabut, GPS dimatikan, atau kamera terputus di tengah alur, layar izin muncul lagi beserta langkah membuka izin di Chrome Android/Safari iPhone. Absensi butuh HTTPS.
- **Peta.** Leaflet + OpenStreetMap (tanpa API key) menampilkan area sekolah (titik + radius dari `GET /student/attendance/today`), posisi siswa, dan akurasi GPS. Pemeriksaan lokasi ke server (`precheck`) berjalan otomatis sekali setelah akurasi cukup, lalu manual (berbagi rate limit dengan check-in).
- **Foto wajah.** Hanya kamera depan langsung (tanpa unggah galeri). Deteksi wajah MediaPipe BlazeFace berjalan di perangkat; tombol foto aktif bila tepat satu wajah jelas, cukup dekat, dan di tengah bingkai. Pencocokan wajah dengan foto terdaftar belum termasuk (fase terpisah).
- **Batasan jujur.** Browser tidak melaporkan lokasi palsu seperti aplikasi, dan User-Agent dapat dipalsukan. Karena itu setiap absen web diberi flag anomali `WEB_CHECKIN` (LOW) agar admin tahu sumbernya; flag perangkat (`DEVICE_SESSION_MISMATCH`, `NEW_DEVICE`, `SHARED_DEVICE`), selfie duplikat, dan geofence server tetap berlaku.
- **Aset.** Runtime WASM MediaPipe (~12 MB/varian) disalin ke `public/vendor/mediapipe` oleh `scripts/vendor-mediapipe.mjs` saat `postinstall` dan `build` (tidak di-commit). Model `public/models/blaze_face_short_range.tflite` di-commit.
- **Akurasi GPS.** Browser tidak bisa memaksa GPS menjadi akurat; akurasi ditentukan perangkat. Alur absen meminta akurasi tinggi, memantau terus dan memakai fix terbaik (`preferFix`), menunggu hingga 15 detik untuk fix yang memenuhi batas sebelum mengirim (`bestPosition`), dan menampilkan langkah sesuai perangkat bila lokasi masih perkiraan jaringan (Android: Akurasi Lokasi Google; iPhone: Lokasi Akurat; laptop: tidak ada GPS). Server tetap menolak fix yang kurang akurat.
- **Alasan terlambat (A1).** Bila precheck memprediksi terlambat, langkah "Periksa & kirim" menampilkan "Kenapa terlambat?" (6 pilihan + keterangan; "Lainnya" wajib ≥ 5 karakter) yang **tidak pernah** menahan tombol kirim. Draf disimpan di atas langkah-langkah (bertahan saat foto/lokasi diulang) dan dikirim **setelah** absen tercatat dari layar "Absensi tercatat" ("Menyimpan alasan…", gagal → "Coba lagi"); bila belum diisi, layar itu menawarkan formulir singkat. Kartu "Hari ini" menampilkan "Alasan terlambat belum diisi." + **Isi alasan** atau "Alasan: …" + **Ubah** sampai jam akhir hari sekolah. Tidak pernah modal. Admin melihat alasan di detail catatan, tag "Alasan: …" di daftar peta, kolom Kehadiran "07:31 · Hujan / cuaca", dan tab "Alasan terlambat" (hitungan per kategori). Aturan murni: `src/lib/attendance/late-reason-rules.ts`; komponen: `src/components/hub/attendance/late-reason-form.tsx`.
- **Demo.** Di mode demo, area sekolah **dan akurasi GPS** disimulasikan di sekitar posisi pengguna dan pengiriman absen ditolak, sehingga seluruh alur bisa didemokan dari HP maupun laptop. "Bukan saya" di demo keluar ke halaman masuk dengan penjelasan (tanpa panggilan server). "Akan terlambat" demo dihitung dari jam lokal terhadap batas tepat waktu, jadi pemilih alasan terlambat muncul bila dicoba setelah 07:15 WIB; Citra bisa mengisi alasan dari kartu "Hari ini" (simulasi, hilang saat dimuat ulang).

## Kehadiran admin: tinjau anomali (B1)

- **Antrean.** Catatan beranomali (flag MEDIUM/HIGH) yang belum ditinjau ditandai "Perlu ditinjau": tanda "!" pada pin, tag merah di daftar peta, legenda "N perlu ditinjau", filter Data Absensi "Anomali: Belum ditinjau", dan tab "Anomali" (default belum ditinjau, hari ini s.d. 45 hari ke belakang; filter Valid / Tidak valid / Semua anomali, default 7 hari).
- **Keputusan di detail catatan** (`anomaly-review-panel.tsx`, dibuka dari pin, daftar, Data lengkap, atau Anomali). **Valid** = absensi tetap (catatan opsional). **Tidak valid** = status menjadi Alpa lewat jalur Koreksi absensi; alasan wajib ≥ 5 karakter karena dikirim ke siswa (chip cepat: "Foto bukan wajah siswa", "Wajah tidak terlihat jelas", "HP dipakai siswa lain", "Tidak berada di sekolah"). Untuk catatan > 45 hari, admin sekolah melihat penjelasan di tempat tombol Tidak valid (hanya super admin). Flag yang tampil ikut dikirim; bila flag berubah sejak dialog dibuka, panel memuat ulang dengan pesan "Catatan pemeriksaan berubah sejak dibuka…".
- **Setelah ditinjau.** Ringkasan "Valid · <peninjau> · <waktu sekolah>" (+ "Ubah jadi tidak valid") atau "Tidak valid …" dengan tombol **Koreksi absensi** bila status masih Alpa; Koreksi diisi dari catatan yang sedang dilihat (siswa & tanggal detail, bukan filter halaman). Tidak valid tidak bisa kembali ke Valid; setelah dipulihkan lewat Koreksi tag menjadi "Tidak valid · dipulihkan".
- **Demo.** Satu tinjauan contoh (Teguh Santoso, Valid oleh "Pak Dodi (Guru BK)") dan Yoga Pratama (`FACE_NOT_DETECTED`) di antrean. Keputusan di demo **disimpan di memori halaman** (pengecualian dari aturan demo yang menolak simpan) supaya alurnya bisa dicoba; hilang saat halaman dimuat ulang dan tidak pernah ke server. Filter tinjauan berlaku juga di demo (`demoRows` menerima parameter tampilan).
- Aturan murni: `src/lib/attendance/anomaly-review-rules.ts` (server & klien) dan `src/components/hub/attendance-admin/monitor-rules.ts` (`reviewTag`, teks hasil/galat).

## Iklan sponsor

Permintaan pemilik 2026-09-26: iklan **halus tapi tetap terlihat** — aplikasi tidak boleh terkesan "butuh uang".

- **Satu slot saja**, di beranda siswa di bawah menu utama dan di atas pengumuman (`src/components/hub/ads/sponsor-slot.tsx`). Tidak pernah tampil di alur absen, rapor, tagihan, atau halaman lain; tanpa pop-up, tanpa suara/video, tanpa iklan layar penuh.
- **Bentuk:** kartu native — banner 2:1 (1200×600) dengan label kecil "Sponsor", nama mitra, judul dua baris, ajakan "Lihat". Lebih dari satu mitra → carousel geser (kartu berikutnya mengintip, titik navigasi); putar otomatis 7 detik berhenti selamanya begitu siswa menyentuh slot dan dimatikan untuk `prefers-reduced-motion`. Judul bagian "Dari mitra studenthub.id" + tombol "Kenapa ada ini?" (iklan dipilih menurut wilayah sekolah, bukan data pribadi, dan ditinjau tim sebelum tayang). Slot hilang sepenuhnya bila tidak ada iklan atau permintaan gagal.
- **Impresi** dihitung setelah ≥ 50% kartu terlihat selama 1 detik, dikirim batch (≤ 20 token, tiap 4 detik, saat tab disembunyikan, dan sebelum klik). **Klik:** tab baru dibuka sinkron di dalam ketukan (Safari iPhone memblokir `window.open` setelah `await`), impresi dikirim dulu agar klik sah, lalu tab diarahkan ke `targetUrl` dari server yang diperiksa ulang (`https` untuk tautan luar; skema berbahaya ditolak). Aturan murni di `src/lib/frontend/ad-slot-rules.ts`.
- **Gambar:** banner yang disetujui disalin ke `/media/…`. Klien membaca path `/media/…` dari domain yang sedang dibuka (domain di `PUBLIC_MEDIA_BASE_URL` bisa berbeda); nginx melayaninya dari disk, dan route cadangan `src/app/media/[...key]/route.ts` melayani salinan publik banner saja bila vhost belum punya alias. Banner yang gagal dimuat diganti inisial mitra.
- **Pratinjau penempatan** (`ads/placement-preview.tsx`) memakai kartu yang sama persis di tiruan layar HP; dipakai di halaman sponsor dan moderasi super admin agar yang ditinjau = yang dilihat siswa.
- **Demo:** banner fiktif di `public/demo/ads/*.svg` dan satu cerita data (`src/lib/frontend/demo-ads.ts`) dipakai bersama oleh siswa, sponsor (PT Cahaya Ilmu Nusantara), dan super admin; klik di demo hanya menampilkan pemberitahuan.

## Struktur dan pemeliharaan

- `src/components/hub/`: shell, dashboard, beranda siswa, formulir, detail, kalender, lembar nilai.
- `src/components/hub/attendance/`: halaman absensi, alur absen, izin perangkat, peta, kamera wajah.
- `src/lib/frontend/attendance.ts`: aturan murni alur absensi (verdict wajah, pesan izin, id perangkat, jam sekolah, "akan terlambat" demo) + test.
- `src/lib/attendance/late-reason-rules.ts` + `src/components/hub/attendance/late-reason-form.tsx`: alasan terlambat (A1).
- `src/lib/frontend/identity-confirm-rules.ts` + `src/components/hub/attendance/identity-step.tsx`: konfirmasi akun sebelum absen (masker NISN, teks kartu, pesan halaman masuk) + test (A2).
- `src/components/hub/attendance-admin/{anomaly-review-panel,record-host}.tsx` + `src/lib/frontend/demo-reviews.ts`: tinjau anomali di detail catatan, perpindahan ke Koreksi absensi, tinjauan demo (B1).
- `src/app/globals.css` + `src/styles/{shell,content,student}.css`: token dan tata letak (teks dasar 16px, warna status sama untuk semua sekolah).
- `src/styles/glass.css`: material "liquid glass". Blur nyata hanya pada topbar, tab bar HP, laci navigasi HP, dialog, dan toast; kartu memakai kaca semu tanpa blur; tabel, formulir, dan isi dialog tetap padat. Tersedia cadangan untuk `prefers-reduced-transparency`, `prefers-contrast: more`, browser tanpa `backdrop-filter`, perangkat bermemori kecil (`data-glass="lite"`), dan sakelar **Tampilan kontras tinggi** di sidebar (`data-glass="off"`, per perangkat).
- `src/styles/transitions.css` + `src/components/hub/page-slide.ts` + `hub-link.tsx`: transisi halaman **tanpa** View Transitions API (di Safari/WebKit lapisannya mengabaikan z-index dan halaman baru sempat tampil di tempat sebelum animasi, sehingga dua halaman tumpang tindih). Yang digeser adalah `.hub-view` = seluruh isi yang ikut tergulir (banner demo, pemilih sekolah, dan halaman), jadi tidak ada bagian atas yang muncul seketika di atas halaman yang masih bergeser; judul topbar ikut masuk sambil memudar. Saat navigasi dimulai (klik tautan hub atau tombol kembali/maju browser), isi lama disalin menjadi "hantu" statis; setelah halaman baru dirender, keduanya digeser dengan CSS biasa (420 ms, ease-in-out; di desktop berupa pudar halus). Di layar ≤ 960px ada dua jenis: **pindah tab** (bottom nav dan laci Menu, `HubLink tab`) menggeser isi lama & baru bersebelahan searah posisi tab — tab tujuan di kiri masuk dari kiri, di kanan masuk dari kanan; halaman dari laci Menu dianggap berada di posisi tombol Menu (paling kanan). **Halaman di dalam halaman utama** (ubin beranda, lonceng notifikasi, avatar, tombol kembali) memakai gaya iOS: membuka halaman menggeser isi baru dari kanan menutupi isi lama, kembali menggeser isi lama ke kanan. Tombol kembali/maju browser membalik langkah dengan jenis yang sama saat langkah itu dibuat (aturan murni + test: `src/lib/frontend/page-slide-rules.ts`). Kedua isi pekat selama animasi, urutan lapisan memakai z-index biasa, luapan horizontal dipotong (`overflow-x: clip`) agar viewport HP tidak melebar, dan alur absen (`?absen=1`) baru dibuka setelah geser selesai. Usap-kembali bawaan iOS/Android tidak ditambah animasi kedua. Diuji di Chromium dan WebKit (`tests/browser/transitions-webkit.spec.ts`, butuh `pnpm exec playwright install webkit`).
- `src/components/hub/scroll-memory.ts` + `src/lib/frontend/scroll-memory-rules.ts`: **ingatan posisi gulir per halaman** (seperti tab bar aplikasi HP). Pemulihan gulir bawaan browser dimatikan (`history.scrollRestoration = "manual"`) dan `HubLink` memakai `scroll={false}`; posisi halaman yang tampil dicatat saat digulir, lalu saat halaman berganti (layout effect, sebelum dilukis dan sebelum geser dimulai) halaman tujuan digulir ke posisi terakhirnya — halaman yang belum pernah dibuka mulai dari atas. Karena isi dimuat asinkron, posisi tujuan dijaga setiap kali tinggi dokumen berubah sampai pengguna menyentuh/menggulir sendiri atau 4 detik berlalu. Menekan tab/tautan halaman yang sedang dibuka menggulir ke atas (ala iOS). Posisi dilupakan saat akun/peran berganti.
- `src/styles/print.css`: cetak isi dialog saja; rapor sebagai A4.
- **Tema sekolah**: `src/lib/schools/theme-rules.ts` (aturan murni: warna, kontras WCAG, turunan token, 8 preset) → `src/lib/frontend/theme.ts` (`applyTheme` memasang token di `<html>` dan warna bilah browser) → halaman `theme-settings.tsx`. Tema dari `GET /auth/me` (`school.theme`), sehingga admin **dan siswa** sekolah itu melihat warna yang sama. Warna apa pun diterima; turunan tema menjaga teks tetap terbaca (≥ 4.5:1) dan editor memberi tahu bila warna disesuaikan otomatis. Di mode demo, tema disimpan per sesi browser.
- **Logo StudentHub**: sumber `docs/brand/studenthub-logo.jpg` → `node scripts/brand-assets.mjs` membuat `public/brand/mark.webp` (tanda transparan untuk UI), aset splash `public/brand/splash-*.webp`, `src/app/icon.png`, dan `src/app/apple-icon.png`, serta mencetak geometri splash (salin ke `MARK_ORIGIN`/`MARK_INSCRIBED` di `splash-rules.ts` dan `--splash-ox/oy` di `splash.css`). Komponen `Brand`/`BrandMark` (`icon.tsx`): tanda + tulisan "Student" (`--brand-ink`) "Hub" (`--brand-hub`) berfont Fredoka (`--font-brand`). Warna logo tetap, tidak ikut tema sekolah; token tema `--logo` hanya untuk ikon sekolah, ikon pintasan, dan kop rapor.
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

