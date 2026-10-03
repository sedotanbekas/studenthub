import { defineContract, type AnyContract } from "@/lib/http/contract";
import { attendanceTestModeResponse, correctionBody, correctionParams, correctionQuery, correctionResponse, recloseDayBody, recloseDayResponse } from "./admin-schemas";
import { anomalyReviewBody, anomalyReviewParams, anomalyReviewQuery, anomalyReviewResultSchema } from "./anomaly-review-schemas";
import { CORRECTION_WINDOW_DAYS } from "./correction-rules";

/** Kontrak route absensi bagian "admin": koreksi manual catatan absensi & tutup-ulang hari (super admin). */
const TAG = "Absensi (Admin)";

export const correctAttendanceContract = defineContract({
  id: "correctStudentAttendanceDay",
  method: "PUT",
  path: "/api/v1/school/attendance/students/{studentId}/days/{date}",
  tag: TAG,
  summary: "Koreksi absensi siswa pada satu tanggal (upsert)",
  description:
    `Tanpa baris -> dibuat dengan sumber ADMIN (kelas = kelas siswa saat ini); ada baris -> status/lateMinutes diganti, sumber menjadi ADMIN, ` +
    `catatan = alasan; bukti check-in (koordinat, selfie, perangkat, flag anomali) tetap. Status & menit terlambat sama -> unchanged=true tanpa audit/notifikasi. ` +
    `Tanggal harus <= hari ini lokal sekolah (422 FUTURE_DATE) dan hari sekolah (422 NOT_SCHOOL_DAY); admin sekolah hanya ${CORRECTION_WINDOW_DAYS} hari terakhir ` +
    `(422 CORRECTION_WINDOW_EXPIRED), super admin tanpa batas. Setiap koreksi diaudit (sebelum/sesudah) dan siswa menerima notifikasi ATTENDANCE_CORRECTED. ` +
    `Super admin wajib ?schoolId=; siswa sekolah lain -> 404.`,
  action: "attendance.correct",
  params: correctionParams,
  query: correctionQuery,
  body: correctionBody,
  response: correctionResponse,
  errors: ["FUTURE_DATE", "NOT_SCHOOL_DAY", "CORRECTION_WINDOW_EXPIRED", "CONFLICT_RETRY"],
});

export const reviewAnomalyContract = defineContract({
  id: "reviewAttendanceAnomaly",
  method: "POST",
  path: "/api/v1/school/attendance/{id}/anomaly-review",
  tag: TAG,
  summary: "Tinjau anomali satu catatan: Valid / Tidak valid",
  description:
    "VALID = absensi tetap, catatan keluar dari antrean 'Perlu ditinjau' (catatan opsional). INVALID = jalur Koreksi absensi menjadi ALPHA " +
    `(sumber ADMIN, catatan = alasan wajib min. 5 karakter, bukti check-in & flag tetap; admin sekolah hanya ${CORRECTION_WINDOW_DAYS} hari terakhir — ` +
    "422 CORRECTION_WINDOW_EXPIRED; bukan hari sekolah 422 NOT_SCHOOL_DAY) dan siswa menerima ATTENDANCE_CORRECTED. Keputusan sama -> unchanged=true " +
    "tanpa audit/notifikasi. INVALID tidak bisa kembali ke VALID (409 ANOMALY_ALREADY_INVALID) — pulihkan status lewat Koreksi absensi; keputusan " +
    "mencatat tinjauan, status catatan yang berwenang. `flags` = kode flag yang dilihat admin; berbeda dengan yang tersimpan -> 409 ANOMALY_FLAGS_CHANGED. " +
    "Catatan tanpa anomali -> 422 NO_ANOMALY. Flag baru kelak membuka lagi tinjauan VALID. Diaudit attendance.anomaly_review. Super admin wajib ?schoolId=; catatan sekolah lain -> 404.",
  action: "attendance.anomaly_review",
  params: anomalyReviewParams,
  query: anomalyReviewQuery,
  body: anomalyReviewBody,
  response: anomalyReviewResultSchema,
  errors: ["NO_ANOMALY", "ANOMALY_ALREADY_INVALID", "ANOMALY_FLAGS_CHANGED", "NOT_SCHOOL_DAY", "CORRECTION_WINDOW_EXPIRED", "CONFLICT_RETRY"],
});

export const recloseDayContract = defineContract({
  id: "recloseAttendanceDay",
  method: "POST",
  path: "/api/v1/platform/attendance/close-day",
  tag: "Absensi (Super Admin)",
  summary: "Tutup ulang satu hari sekolah (auto-ALPHA manual)",
  description:
    "Untuk hari lampau yang sudah ditutup tetapi datanya hilang/berubah (mis. libur ditambah lalu dihapus, tick mati lebih dari 7 hari). " +
    "Penutupan idempoten yang sama dengan job auto-ALPHA: siswa wajib absen tanpa catatan -> ALPHA, atau IZIN/SAKIT bila izin disetujui " +
    "mencakup tanggal; catatan yang ada tidak diubah; bukan hari sekolah -> isSchoolDay=false tanpa baris. JobRun tanggal itu ditulis " +
    "SUCCEEDED dan tindakan diaudit (attendance.reclose_day). Tanggal harus sudah ditutup (422 DAY_NOT_CLOSED) dan tidak sebelum sekolah " +
    "terdaftar (422 DATE_BEFORE_SCHOOL_START); sekolah tak dikenal -> 404. Seperti tick, penutupan memberi notifikasi Alpa ke siswa " +
    "(tanggal <= 3 hari lalu) & rekap ke admin (<= 1 hari), sekali per tanggal per penerima — tutup ulang tidak menggandakannya.",
  action: "attendance.reclose",
  body: recloseDayBody,
  response: recloseDayResponse,
  errors: ["SCHOOL_NOT_FOUND", "DAY_NOT_CLOSED", "DATE_BEFORE_SCHOOL_START"],
});

const TEST_MODE_PATH = "/api/v1/platform/attendance/test-mode";
const TEST_MODE_EFFECT =
  "Mode uji absensi (SEMENTARA, untuk uji coba): selama aktif, jarak ke sekolah (geofence) dan jam/hari absen TIDAK diperiksa untuk SEMUA sekolah; " +
  "lokasi (0,0), lokasi palsu, data lokasi basi, akurasi GPS, selfie, dan sesi HP tetap wajib. Check-in yang lolos hanya karena mode ini diberi flag TEST_MODE (tampil di antrean anomali admin sekolah).";

export const getAttendanceTestModeContract = defineContract({
  id: "getAttendanceTestMode",
  method: "GET",
  path: TEST_MODE_PATH,
  tag: "Absensi (Super Admin)",
  summary: "Status mode uji absensi (longgarkan lokasi & jam absen)",
  description: TEST_MODE_EFFECT,
  action: "attendance.test_mode",
  response: attendanceTestModeResponse,
});

export const enableAttendanceTestModeContract = defineContract({
  id: "enableAttendanceTestMode",
  method: "POST",
  path: TEST_MODE_PATH,
  tag: "Absensi (Super Admin)",
  summary: "Nyalakan mode uji absensi (absen dari mana saja, kapan saja)",
  description: `${TEST_MODE_EFFECT} Idempoten; perubahan diaudit (platform.attendance_test_mode.enable).`,
  action: "attendance.test_mode",
  response: attendanceTestModeResponse,
});

export const disableAttendanceTestModeContract = defineContract({
  id: "disableAttendanceTestMode",
  method: "DELETE",
  path: TEST_MODE_PATH,
  tag: "Absensi (Super Admin)",
  summary: "Kunci kembali lokasi & jam absen (matikan mode uji)",
  description: "Absensi kembali memeriksa jarak ke sekolah serta jam dan hari absen. Idempoten; perubahan diaudit (platform.attendance_test_mode.disable).",
  action: "attendance.test_mode",
  response: attendanceTestModeResponse,
});

export const attendanceAdminContracts: readonly AnyContract[] = [
  correctAttendanceContract, reviewAnomalyContract, recloseDayContract, getAttendanceTestModeContract, enableAttendanceTestModeContract, disableAttendanceTestModeContract,
];
