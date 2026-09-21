import { defineContract, type AnyContract } from "@/lib/http/contract";
import { correctionBody, correctionParams, correctionQuery, correctionResponse, recloseDayBody, recloseDayResponse } from "./admin-schemas";
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
    "terdaftar (422 DATE_BEFORE_SCHOOL_START); sekolah tak dikenal -> 404.",
  action: "attendance.reclose",
  body: recloseDayBody,
  response: recloseDayResponse,
  errors: ["SCHOOL_NOT_FOUND", "DAY_NOT_CLOSED", "DATE_BEFORE_SCHOOL_START"],
});

export const attendanceAdminContracts: readonly AnyContract[] = [correctAttendanceContract, recloseDayContract];
