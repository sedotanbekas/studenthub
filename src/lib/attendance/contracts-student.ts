import { defineContract, type AnyContract } from "@/lib/http/contract";
import { CHECKIN_MAX_BODY_BYTES, HISTORY_MAX_MONTHS_BACK } from "./constants";
import {
  checkInBody,
  checkInResultSchema,
  historyQuery,
  historySchema,
  precheckBody,
  precheckResultSchema,
  summaryQuery,
  summarySchema,
  todaySchema,
} from "./student-schemas";

/** Kontrak route absensi bagian "student": /student/attendance/* (siswa atas dirinya sendiri). */
const TAG = "Absensi Siswa";
const SELF_NOTE = "Siswa hanya melihat/menulis absensinya sendiri; id siswa tidak pernah diterima dari request.";
const LOCATION_ERRORS = ["INVALID_LOCATION", "MOCK_LOCATION", "LOCATION_STALE", "GPS_ACCURACY_TOO_LOW", "OUTSIDE_GEOFENCE"] as const;
const CALENDAR_ERRORS = ["NOT_SCHOOL_DAY", "CHECKIN_NOT_OPEN", "CHECKIN_CLOSED"] as const;
const CHECK_IN_RULES =
  "Urutan: catatan hari ini (CHECKIN -> 200 replayed; ADMIN/AUTO_ALPHA -> 409 ATTENDANCE_ALREADY_RECORDED; LEAVE -> dikonversi) -> " +
  "hari sekolah (422 NOT_SCHOOL_DAY {reason, holidayName}) -> jendela [buka, tutup) (422 CHECKIN_NOT_OPEN {opensAt} / CHECKIN_CLOSED {closedAt}) -> " +
  "lokasi: (0,0) 422 INVALID_LOCATION, mocked=true 422 MOCK_LOCATION, umur fix > 180 s 422 LOCATION_STALE {fixAgeS}, " +
  "akurasi kosong/> 100 m 422 GPS_ACCURACY_TOO_LOW {accuracyM, maxAccuracyM}, jarak > radius + min(akurasi, 50) 422 OUTSIDE_GEOFENCE {distanceM, radiusM}. " +
  "Diterima: TERLAMBAT bila menit lokal > mulai + toleransi (lateMinutes dari bel masuk), selain itu HADIR. Tanggal & jam dari server.";

export const todayAttendanceContract = defineContract({
  id: "getOwnAttendanceToday",
  method: "GET",
  path: "/api/v1/student/attendance/today",
  tag: TAG,
  summary: "Status absensi hari ini (layar Absensi)",
  description: `Hari sekolah?, jendela buka/terlambat/tutup (HH:mm lokal), radius geofence (TANPA titik pusat), catatan hari ini, izin PENDING yang mencakup hari ini, dan canCheckIn/blockReason. ${SELF_NOTE}`,
  action: "attendance.self",
  response: todaySchema,
  errors: ["STUDENT_NOT_ACTIVE"],
});

export const precheckAttendanceContract = defineContract({
  id: "precheckOwnAttendance",
  method: "POST",
  path: "/api/v1/student/attendance/precheck",
  tag: TAG,
  summary: "Cek lokasi sebelum memotret selfie",
  description: `Menjalankan keputusan yang SAMA dengan check-in tanpa selfie dan tanpa menulis apa pun (percobaan tidak dicatat). ok=false + reason bila check-in akan ditolak. Berbagi rate limit CHECK_IN (10 / 10 menit) dengan check-in. ${SELF_NOTE}`,
  action: "attendance.self",
  body: precheckBody,
  response: precheckResultSchema,
  rateLimit: { limiter: "CHECK_IN", key: "user" },
  errors: ["STUDENT_NOT_ACTIVE"],
});

export const checkInAttendanceContract = defineContract({
  id: "checkInOwnAttendance",
  method: "POST",
  path: "/api/v1/student/attendance/check-in",
  tag: TAG,
  summary: "Check-in dengan selfie + lokasi",
  description: `${CHECK_IN_RULES} 201 = tercatat; 200 = catatan hari ini sudah ada (replayed=true, selfie kedua dibuang). Percobaan yang ditolak karena lokasi dicatat untuk admin (maks 20/hari). Selfie hanya diproses bila diterima (415 format, 413 ukuran, 422 IMAGE_*). Flag anomali tidak pernah dikirim ke siswa. ${SELF_NOTE}`,
  action: "attendance.self",
  body: checkInBody,
  bodyType: "multipart",
  maxBodyBytes: CHECKIN_MAX_BODY_BYTES,
  response: checkInResultSchema,
  successStatus: 201,
  rateLimit: { limiter: "CHECK_IN", key: "user" },
  errors: [
    "STUDENT_NOT_ACTIVE",
    "ATTENDANCE_ALREADY_RECORDED",
    ...CALENDAR_ERRORS,
    ...LOCATION_ERRORS,
    "IMAGE_UNREADABLE",
    "IMAGE_TOO_SMALL",
    "IMAGE_TOO_LARGE",
    "HEIC_NOT_SUPPORTED",
    "CONFLICT_RETRY",
    "SERVICE_UNAVAILABLE",
  ],
});

export const attendanceMonthContract = defineContract({
  id: "listOwnAttendanceMonth",
  method: "GET",
  path: "/api/v1/student/attendance",
  tag: TAG,
  summary: "Riwayat absensi satu bulan",
  description: `Catatan per hari, hari non-sekolah (libur/di luar semester/hari libur mingguan), dan ringkasan (hanya hari yang sudah ditutup). meta = {prevMonth, nextMonth} (null di luar batas). Bulan berjalan s.d. ${HISTORY_MAX_MONTHS_BACK} bulan ke belakang (422 MONTH_OUT_OF_RANGE). Siswa Aktif & Lulus. ${SELF_NOTE}`,
  action: "attendance.self.read",
  query: historyQuery,
  response: historySchema,
  errors: ["MONTH_OUT_OF_RANGE"],
});

export const attendanceSummaryContract = defineContract({
  id: "getOwnAttendanceSummary",
  method: "GET",
  path: "/api/v1/student/attendance/summary",
  tag: TAG,
  summary: "Ringkasan absensi satu semester",
  description: `Jumlah per status & persentase hadir (HADIR + TERLAMBAT) atas hari yang sudah ditutup (closedThrough). termId milik sekolah lain -> 404. Siswa Aktif & Lulus. ${SELF_NOTE}`,
  action: "attendance.self.read",
  query: summaryQuery,
  response: summarySchema,
});

export const attendanceStudentContracts: readonly AnyContract[] = [
  todayAttendanceContract,
  precheckAttendanceContract,
  checkInAttendanceContract,
  attendanceMonthContract,
  attendanceSummaryContract,
];
