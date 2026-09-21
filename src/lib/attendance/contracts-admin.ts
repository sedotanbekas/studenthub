import { defineContract, type AnyContract } from "@/lib/http/contract";
import { correctionBody, correctionParams, correctionQuery, correctionResponse } from "./admin-schemas";
import { CORRECTION_WINDOW_DAYS } from "./correction-rules";

/** Kontrak route absensi bagian "admin": koreksi manual catatan absensi. */
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

export const attendanceAdminContracts: readonly AnyContract[] = [correctAttendanceContract];
