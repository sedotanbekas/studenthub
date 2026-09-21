import type { SchoolTimezone } from "@prisma/client";
import { getTodayStats } from "@/lib/attendance/monitoring-queries";
import { requirePrincipal, type ActionContext } from "@/lib/auth/principal";
import { billingStats } from "@/lib/billing/stats";
import { prisma } from "@/lib/db";
import { notFound } from "@/lib/http/errors";
import { reportCardStats } from "@/lib/report-cards/stats";
import { resolveSchoolScope, type SchoolScope } from "@/lib/tenant/scope";
import { localPeriodFor, studentCountsFrom, type StudentCounts } from "./rules";
import type { DashboardSummaryDto, DashboardSummaryQuery } from "./schemas";

/**
 * Ringkasan dashboard admin sekolah: menjalankan query domain yang sudah ada secara paralel (siswa per
 * status, kartu kehadiran hari ini, corong rapor semester, statistik SPP bulan berjalan). Baca saja,
 * tanpa transaksi: tiap kartu konsisten sendiri-sendiri.
 */
async function studentCounts(scope: SchoolScope): Promise<StudentCounts> {
  const groups = await prisma.student.groupBy({ by: ["status"], where: { schoolId: scope.schoolId }, _count: { _all: true } });
  return studentCountsFrom(groups.map((group) => ({ status: group.status, count: group._count._all })));
}

/** Sekolah dalam cakupan; SUPER_ADMIN dengan schoolId tak dikenal -> 404 SCHOOL_NOT_FOUND (sebelum query paralel). */
async function loadSchoolTimezone(scope: SchoolScope): Promise<SchoolTimezone> {
  const school = await prisma.school.findUnique({ where: { id: scope.schoolId }, select: { timezone: true } });
  if (!school) throw notFound("Sekolah tidak ditemukan.", "SCHOOL_NOT_FOUND");
  return school.timezone;
}

export async function getDashboardSummary(ctx: ActionContext, query: DashboardSummaryQuery): Promise<DashboardSummaryDto> {
  const scope = resolveSchoolScope(requirePrincipal(ctx), query.schoolId);
  const timezone = await loadSchoolTimezone(scope);
  const [students, attendanceToday, reportCards, billing] = await Promise.all([
    studentCounts(scope),
    getTodayStats(ctx, scope.schoolId),
    reportCardStats(scope, { termId: query.termId }),
    billingStats(scope, localPeriodFor(ctx.now, timezone), ctx.now),
  ]);
  return { students, attendanceToday, reportCards, billing };
}
