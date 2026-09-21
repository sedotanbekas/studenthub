/**
 * Konstanta domain absensi (check-in siswa). Nilai mengikuti docs/design/02-attendance.md §3.1 dan
 * keputusan klien di docs/PLAN.md (fake GPS DITOLAK, selfie wajib).
 */

/** Akurasi GPS terburuk yang masih diterima (meter, radius keyakinan 68% expo-location). */
export const MAX_ACCEPTED_ACCURACY_M = 100;
/** Toleransi geofence = min(akurasi, batas ini): jarak <= radius + toleransi. */
export const ACCURACY_TOLERANCE_CAP_M = 50;
/** Flag LOW_ACCURACY bila akurasi di atas nilai ini. */
export const LOW_ACCURACY_FLAG_M = 50;
/** Flag PERFECT_ACCURACY bila akurasi <= nilai ini (aplikasi mock melaporkan 0/1 m). */
export const SUSPICIOUS_ACCURACY_M = 1;
/** Keputusan klien: lokasi palsu (mocked=true) DITOLAK 422, bukan sekadar ditandai. */
export const BLOCK_MOCKED_LOCATION = true;

/** Umur fix (clientTime - locationTimestamp) di atas ini -> flag STALE_FIX. */
export const FIX_AGE_FLAG_S = 60;
/** Umur fix di atas ini -> tolak LOCATION_STALE. */
export const FIX_AGE_REJECT_S = 180;
/** Fix bertanggal lebih baru dari waktu kirim melebihi ini -> flag TIME_INCONSISTENT. */
export const FIX_FUTURE_TOLERANCE_S = 10;
/** Selisih jam perangkat vs server di atas ini -> flag CLOCK_SKEW. */
export const CLOCK_SKEW_FLAG_S = 300;
/** Perangkat diikat ulang (login perangkat baru) dalam jendela ini -> flag NEW_DEVICE. */
export const NEW_DEVICE_WINDOW_DAYS = 7;
/** DUPLICATE_SELFIE dibandingkan dengan selfie siswa itu sendiri selama periode ini. */
export const DUPLICATE_SELFIE_LOOKBACK_DAYS = 60;
/** Batas kandidat pembanding dHash (satu selfie per hari sekolah ~ 45 dalam 60 hari). */
export const DUPLICATE_SELFIE_MAX_CANDIDATES = 120;
/** Batas baris lain yang ikut ditandai SHARED_DEVICE dalam satu check-in (best effort). */
export const SHARED_DEVICE_MAX_ROWS = 20;

/** CHECK chk_attendance_late: lateMinutes 1..720. */
export const MAX_LATE_MINUTES = 720;
/** Koordinat absensi disimpan 7 desimal (kolom Decimal(10,7)). */
export const STORED_COORD_DECIMALS = 7;

/** Maksimal percobaan ditolak yang dicatat per siswa per hari lokal. */
export const MAX_LOGGED_REJECTIONS_PER_DAY = 20;
/** Koordinat percobaan ditolak dibulatkan 3 desimal (~100 m) demi privasi anak. */
export const REJECTION_COORD_DECIMALS = 3;
/** Koordinat percobaan ditolak dibuang seluruhnya bila jarak ke sekolah di atas ini. */
export const REJECTION_COORD_MAX_DISTANCE_M = 2000;

/** Riwayat bulanan siswa: bulan berjalan sampai 24 bulan sebelumnya. */
export const HISTORY_MAX_MONTHS_BACK = 24;
/** Batas body multipart check-in: selfie maks 5 MiB (UPLOAD_POLICY) + ruang field & boundary. */
export const CHECKIN_MAX_BODY_BYTES = 5 * 1024 * 1024 + 256 * 1024;

/** Catatan pada baris izin yang dikonversi menjadi hadir. */
export const LEAVE_CONVERSION_NOTE = "Hadir pada hari izin";
