-- Mode uji absensi (SEMENTARA, keputusan pemilik 2026-10-02). Aditif saja: kolom DATETIME nullable baru di
-- baris tunggal PlatformSetting (MariaDB 10.11: ADD COLUMN instan). NULL = terkunci (perilaku normal);
-- super admin menyalakannya lewat POST /platform/attendance/test-mode (diaudit). Selama terisi, jarak ke
-- sekolah dan jam/hari absen tidak diperiksa untuk semua sekolah; akurasi GPS, lokasi palsu, dan selfie tetap.
ALTER TABLE `PlatformSetting`
  ADD COLUMN `attendanceTestModeSince` DATETIME(3) NULL;
