import { z } from "zod";
import { defineContract, type AnyContract } from "@/lib/http/contract";
import {
  anomaliesQuery,
  anomalyRowSchema,
  classAnalyticsSchema,
  classParams,
  classTrendQuery,
  classTrendSchema,
  dailyQuery,
  dailyRowSchema,
  dateScopeQuery,
  mapQuery,
  mapSchema,
  monitorScopeQuery,
  monthScopeQuery,
  recapSchema,
  recordDetailSchema,
  recordParams,
  rejectionRowSchema,
  rejectionsQuery,
  studentMonthSchema,
  studentParams,
  studentTrendQuery,
  studentTrendSchema,
  summaryAnalyticsSchema,
  todayStatsSchema,
} from "./monitor-schemas";

/** Kontrak route absensi bagian "monitor": monitoring harian, peta, rekap, anomali, penolakan, analitik. */
const TAG = "Absensi — Monitoring";
const ACTION = "attendance.monitor" as const;
const SCOPE_NOTE = "SUPER_ADMIN wajib mengirim ?schoolId=. Id milik sekolah lain -> 404.";
const CLOSED_NOTE =
  "Persentase dihitung atas baris tercatat pada hari yang sudah ditutup (tanggal <= closedThrough: hari ini setelah dayEndMinute lokal, selain itu kemarin); hadir = HADIR + TERLAMBAT; kelas = kelas snapshot saat dicatat.";

export const todayStatsContract = defineContract({
  id: "monitorAttendanceToday",
  method: "GET",
  path: "/api/v1/school/attendance/stats/today",
  tag: TAG,
  summary: "Kartu Kehadiran Hari Ini",
  description: `eligible = siswa ACTIVE yang sudah aktif hari ini; notYet = eligible - baris hari ini (0 di hari non-sekolah); presentPct = hadir / eligible (null di hari non-sekolah). ${SCOPE_NOTE}`,
  action: ACTION,
  query: monitorScopeQuery,
  response: todayStatsSchema,
  errors: ["SCHOOL_NOT_FOUND"],
});

export const dailyContract = defineContract({
  id: "monitorAttendanceDaily",
  method: "GET",
  path: "/api/v1/school/attendance/daily",
  tag: TAG,
  summary: "Data Absensi satu tanggal (paginasi atas siswa)",
  description: `Baris tanpa catatan = belum absen (hanya di hari sekolah). status=BELUM_ABSEN menampilkan siswa aktif tanpa catatan; anomaly=any hanya catatan beranomali. Urut kelas lalu nama. ${SCOPE_NOTE}`,
  action: ACTION,
  query: dailyQuery,
  response: z.array(dailyRowSchema),
  pagination: "page",
  errors: ["SCHOOL_NOT_FOUND", "CLASS_NOT_FOUND"],
});

export const mapContract = defineContract({
  id: "monitorAttendanceMap",
  method: "GET",
  path: "/api/v1/school/attendance/map",
  tag: TAG,
  summary: "Peta Lokasi check-in",
  description: `points = catatan berkoordinat; unlocated = izin/sakit/alpha/belum absen (tanpa koordinat); rejected = percobaan ditolak (includeRejected=true). Maks 5000 item per daftar; data.truncated & meta.truncated = true bila dipotong. Titik pusat & radius geofence disertakan untuk tampilan. ${SCOPE_NOTE}`,
  action: ACTION,
  query: mapQuery,
  response: mapSchema,
  errors: ["SCHOOL_NOT_FOUND", "CLASS_NOT_FOUND"],
});

export const recapContract = defineContract({
  id: "monitorAttendanceRecap",
  method: "GET",
  path: "/api/v1/school/attendance/recap",
  tag: TAG,
  summary: "Rekap Kelas satu tanggal",
  description: `Per kelas: eligible = tercatat (kelas snapshot) + belum absen (kelas saat ini); presentPct = hadir / eligible (null di hari non-sekolah). Baris tanpa kelas dikelompokkan "Tanpa kelas". ${SCOPE_NOTE}`,
  action: ACTION,
  query: dateScopeQuery,
  response: recapSchema,
  errors: ["SCHOOL_NOT_FOUND"],
});

export const anomaliesContract = defineContract({
  id: "monitorAttendanceAnomalies",
  method: "GET",
  path: "/api/v1/school/attendance/anomalies",
  tag: TAG,
  summary: "Antrean catatan beranomali",
  description: `Rentang default 7 hari terakhir, maksimal 92 hari (400 bila lebih). Terbaru dulu. ${SCOPE_NOTE}`,
  action: ACTION,
  query: anomaliesQuery,
  response: z.array(anomalyRowSchema),
  pagination: "page",
  errors: ["SCHOOL_NOT_FOUND", "CLASS_NOT_FOUND"],
});

export const rejectionsContract = defineContract({
  id: "monitorCheckInRejections",
  method: "GET",
  path: "/api/v1/school/attendance/rejections",
  tag: TAG,
  summary: "Percobaan check-in yang ditolak",
  description: `Koordinat dibulatkan 3 desimal dan kosong bila > 2 km dari sekolah (privasi). Terbaru dulu. ${SCOPE_NOTE}`,
  action: ACTION,
  query: rejectionsQuery,
  response: z.array(rejectionRowSchema),
  pagination: "page",
  errors: ["SCHOOL_NOT_FOUND"],
});

export const classAnalyticsContract = defineContract({
  id: "monitorAttendanceClassAnalytics",
  method: "GET",
  path: "/api/v1/school/attendance/analytics/classes",
  tag: TAG,
  summary: "Persentase kehadiran per kelas satu bulan",
  description: `${CLOSED_NOTE} Rata-rata sekolah digabung (berbobot student-day). period.isPartial & period.unclosedDates (juga di meta): hari sekolah tanpa penutupan auto-alpha sukses. ${SCOPE_NOTE}`,
  action: ACTION,
  query: monthScopeQuery,
  response: classAnalyticsSchema,
  errors: ["SCHOOL_NOT_FOUND"],
});

export const summaryAnalyticsContract = defineContract({
  id: "monitorAttendanceSummaryAnalytics",
  method: "GET",
  path: "/api/v1/school/attendance/analytics/summary",
  tag: TAG,
  summary: "Ringkasan bulan (donat) + selisih bulan lalu",
  description: `${CLOSED_NOTE} deltaPp = presentPct - prevPresentPct dalam poin persen. ${SCOPE_NOTE}`,
  action: ACTION,
  query: monthScopeQuery,
  response: summaryAnalyticsSchema,
  errors: ["SCHOOL_NOT_FOUND"],
});

export const classTrendContract = defineContract({
  id: "monitorAttendanceClassTrend",
  method: "GET",
  path: "/api/v1/school/attendance/analytics/classes/{classId}/trend",
  tag: TAG,
  summary: "Tren harian satu kelas",
  description: `Rentang default 30 hari terakhir, maksimal 92 hari. Setiap hari sekolah muncul (tanpa data -> persen null). ${CLOSED_NOTE} ${SCOPE_NOTE}`,
  action: ACTION,
  params: classParams,
  query: classTrendQuery,
  response: classTrendSchema,
  errors: ["SCHOOL_NOT_FOUND", "CLASS_NOT_FOUND"],
});

export const studentTrendContract = defineContract({
  id: "monitorAttendanceStudentTrend",
  method: "GET",
  path: "/api/v1/school/attendance/analytics/students/{studentId}",
  tag: TAG,
  summary: "Tren bulanan satu siswa",
  description: `months = 1..12 bulan terakhir termasuk bulan berjalan (default 6). ${CLOSED_NOTE} ${SCOPE_NOTE}`,
  action: ACTION,
  params: studentParams,
  query: studentTrendQuery,
  response: studentTrendSchema,
  errors: ["SCHOOL_NOT_FOUND"],
});

export const studentMonthContract = defineContract({
  id: "monitorStudentAttendanceMonth",
  method: "GET",
  path: "/api/v1/school/attendance/students/{studentId}/month",
  tag: TAG,
  summary: "Riwayat absensi bulanan satu siswa",
  description: `Bentuk sama dengan riwayat bulanan siswa (+ identitas siswa). summary hanya menghitung hari <= closedThrough. meta = {prevMonth, nextMonth}. ${SCOPE_NOTE}`,
  action: ACTION,
  params: studentParams,
  query: monthScopeQuery,
  response: studentMonthSchema,
  errors: ["SCHOOL_NOT_FOUND"],
});

export const recordDetailContract = defineContract({
  id: "monitorAttendanceRecord",
  method: "GET",
  path: "/api/v1/school/attendance/{id}",
  tag: TAG,
  summary: "Detail satu catatan absensi",
  description: `Termasuk selfie (url /api/v1/files/{id}; null setelah retensi 180 hari), flag anomali berlabel, percobaan ditolak di hari yang sama, dan 20 entri audit terakhir. ${SCOPE_NOTE}`,
  action: ACTION,
  params: recordParams,
  query: monitorScopeQuery,
  response: recordDetailSchema,
  errors: ["SCHOOL_NOT_FOUND"],
});

export const attendanceMonitorContracts: readonly AnyContract[] = [
  todayStatsContract,
  dailyContract,
  mapContract,
  recapContract,
  anomaliesContract,
  rejectionsContract,
  classAnalyticsContract,
  summaryAnalyticsContract,
  classTrendContract,
  studentTrendContract,
  studentMonthContract,
  recordDetailContract,
];
