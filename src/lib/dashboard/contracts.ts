import { defineContract, type AnyContract } from "@/lib/http/contract";
import { dashboardSummaryQuery, dashboardSummarySchema } from "./schemas";

/** Kontrak route domain dashboard admin sekolah. */
const TAG = "Dashboard";

export const dashboardSummaryContract = defineContract({
  id: "getSchoolDashboardSummary",
  method: "GET",
  path: "/api/v1/school/dashboard/summary",
  tag: TAG,
  summary: "Ringkasan dashboard admin sekolah",
  description:
    "Kartu dashboard dihitung paralel dari query domain: students = jumlah siswa per status; attendanceToday = kartu kehadiran hari ini (sama dengan GET /school/attendance/stats/today); reportCards = corong rapor siswa AKTIF untuk termId (default semester aktif; term null bila tidak ada); billing = siswa AKTIF belum lunas (tagihan berperiode <= bulan ini), bukti menunggu verifikasi, dan rekap tagihan bulan berjalan (waktu lokal sekolah). Admin sekolah: sekolahnya sendiri (schoolId lain -> 403 SCOPE_MISMATCH). Super admin: wajib ?schoolId= (400 SCHOOL_ID_REQUIRED; sekolah tak dikenal -> 404 SCHOOL_NOT_FOUND). termId milik sekolah lain -> 404.",
  action: "dashboard.read",
  query: dashboardSummaryQuery,
  response: dashboardSummarySchema,
  errors: ["SCHOOL_ID_REQUIRED", "SCOPE_MISMATCH", "SCHOOL_NOT_FOUND", "NOT_FOUND"],
});

export const dashboardContracts: readonly AnyContract[] = [dashboardSummaryContract];
