# Backlog — item yang sengaja ditunda

Sumber: `docs/PLAN.md` bagian "Ditunda (YAGNI)" + keputusan implementasi P4–P5. Setiap item dicatat
dengan alasan penundaan dan pemicu untuk mengerjakannya. Urutan tidak menunjukkan prioritas.

## Dari PLAN "Ditunda (YAGNI)"

| Item | Status sekarang | Kerjakan bila |
| --- | --- | --- |
| Transport cookie + CSRF untuk dashboard web | Semua klien memakai Bearer; arsitektur `Principal` sudah siap | Fase frontend dashboard dimulai |
| Penjadwalan / edit pengumuman yang sudah terbit | Terbit langsung; batal = tarik (`cancelledAt`) | Sekolah meminta pengumuman terjadwal |
| Kenaikan kelas massal | Pindah kelas per siswa | **Sebelum Juli 2027** (tahun ajaran berikutnya) |
| Unggahan PDF | Hanya foto JPEG/PNG/WebP (di-encode ulang, tanpa EXIF) | Sekolah wajib menerima surat dokter PDF |
| Push receipts Expo & penggabungan notifikasi admin | Push satu arah; status gagal dari tiket saja; inbox tetap sumber kebenaran | Volume push besar / keluhan push tidak sampai |
| Anomali `IMPOSSIBLE_TRAVEL` / `IDENTICAL_COORDINATES` + workflow review anomali | Flag lain tersimpan; koreksi manual admin dipakai | Pola kecurangan check-in terbukti di lapangan |
| REFUND ledger sponsor | Hanya TOPUP / CLICK_CHARGE / ADJUSTMENT | Ada permintaan pengembalian dana sponsor (butuh aturan batas refundable + persetujuan SA kedua, lihat review-security) |
| Multi-user sponsor | Satu akun login per sponsor | Sponsor korporat butuh beberapa operator |
| Ringkasan platform iklan (super admin) | Analitik per sponsor/iklan saja | Super admin butuh dashboard pendapatan |
| Job rekonsiliasi saldo | Diganti test invarian saldo == ledger | Ada koreksi manual ledger di produksi |
| Target iklan per jenjang sekolah | Target: semua / provinsi / kota / sekolah | Sponsor meminta targeting SD/SMP/SMA |
| Gerbang `X-App-Version` (paksa update app) | Tidak ada | Rilis app yang memutus kompatibilitas API |
| Sub-peran admin sekolah (bendahara/operator) | Satu peran SCHOOL_ADMIN | Sekolah butuh pemisahan tugas SPP vs akademik |
| Check-in offline | Wajib online (server menentukan waktu & lokasi) | Sekolah dengan sinyal buruk meminta mode antre |
| Play Integrity / App Attest | Hanya flag `mocked` + deviceId terikat | Kecurangan lokasi palsu tetap tinggi |

## Tambahan dari implementasi

### Cache penayangan iklan 30 detik per sekolah (design 04 §3.13)
Desain menyebut kandidat iklan di-cache per `schoolId` selama 30 detik. Implementasi P4 **tanpa cache**:
`GET /student/ads` menghitung kandidat langsung dari DB setiap permintaan (lebih sederhana, iklan yang
dijeda/sponsor ditangguhkan langsung berhenti tayang). Kerjakan bila p95 `GET /student/ads` > 200 ms atau
beban DB saat jam istirahat sekolah tinggi. Catatan: cache menambah jendela ≤ 30 s iklan yang dijeda masih
tampil (klik tetap tidak ditagih karena dicek ulang saat klik).

### Token event iklan: `jti` / sekali pakai
Token event (JWT HS256, `AD_EVENT_SECRET`, 6 jam) terikat siswa/iklan/sponsor/sekolah tetapi **tanpa `jti`**
dan boleh dipakai berkali-kali selama berlaku. Dampak dibatasi aturan lain: impresi dihitung maks 1×/30 menit
per siswa-iklan, klik ditagih maks 1×/siswa/iklan/hari, limiter AD_CLICK 10/menit & AD_IMPRESSION 30/menit.
Kerjakan (jti + penyimpanan token terpakai, atau token per slot) bila analitik menunjukkan replay klik/impresi
dari satu akun, atau bila aturan tagih berubah (mis. lebih dari 1 klik ditagih per hari).

### Penyimpan impresi & limiter in-memory = satu proses
`src/lib/ads/impression-store.ts` dan limiter `src/lib/http/rate-limits.ts` menyimpan state di memori proses
(PM2 **fork, 1 instance**). Konsekuensi: restart menghapus dedupe impresi (klik 30 menit pertama setelah
restart bisa dinilai SUSPECT → tidak ditagih, aman untuk sponsor) dan menghitung ulang limiter (termasuk
limiter login & TOTP). **Wajib dipindah ke Redis (atau tabel DB) sebelum** menjalankan lebih dari satu
instance / PM2 cluster mode.

### Step-up TOTP untuk aksi sensitif super admin (review-security)
P5 mewajibkan TOTP saat login super admin. Step-up (TOTP ulang ≤ 5 menit terakhir, `AuthSession.stepUpAt`)
untuk persetujuan top-up, penyesuaian ledger, rekening bank platform/sekolah, geofence, membuat/mereset
super admin **belum** dibuat. Kerjakan bila jumlah super admin > 2 atau ada aksi finansial bernilai besar.

### Reset TOTP super admin lewat API
Reset TOTP hanya lewat CLI operator (`pnpm db:totp-reset --email …`, diaudit). Endpoint "super admin mereset
TOTP super admin lain" ditunda (butuh step-up di atas agar tidak menjadi jalan pintas pengambilalihan akun).

### Kode pemulihan (recovery codes) TOTP
Tidak ada kode cadangan; HP hilang = reset oleh operator via CLI. Kerjakan bila super admin tidak lagi
punya akses shell ke VPS.
