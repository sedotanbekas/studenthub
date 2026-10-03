import type { ActionContext } from "@/lib/auth/principal";
import { prisma } from "@/lib/db";
import { badRequest } from "@/lib/http/errors";
import { toDbDate, type LocalDate } from "@/lib/time/zone";
import { resolveRange } from "./attendance-stats";
import { countLateReasons, type LateReasonGroupCount } from "./late-reason-rules";
import type { LateReasonCountsDto } from "./late-reason-schemas";
import type { LateReasonsQuery } from "./monitor-schemas";
import { assertClassInSchool, loadMonitorSchool, monitorScope, schoolToday } from "./monitoring-queries";

/** Hitungan alasan terlambat per kategori untuk admin (A1). Rentang boleh memuat hari ini (hari berjalan). */

/** Rentang default: maksimal satu bulan kalender (31 hari). */
const DEFAULT_RANGE_DAYS = 31;

/** Baris TERLAMBAT (status saat ini) dalam rentang per (sumber, kategori); kategori null = belum diisi. */
export async function lateReasonGroups(schoolId: string, range: { from: LocalDate; to: LocalDate }, classId?: string): Promise<LateReasonGroupCount[]> {
  const groups = await prisma.attendance.groupBy({
    by: ["source", "lateReasonCategory"],
    where: {
      schoolId,
      status: "TERLAMBAT",
      date: { gte: toDbDate(range.from), lte: toDbDate(range.to) },
      ...(classId ? { classId } : {}),
    },
    _count: { _all: true },
  });
  return groups.map((g) => ({ category: g.lateReasonCategory, source: g.source, count: g._count._all }));
}

/** GET /school/attendance/late-reasons. */
export async function getLateReasonCounts(ctx: ActionContext, query: LateReasonsQuery): Promise<LateReasonCountsDto> {
  const scope = monitorScope(ctx, query.schoolId);
  const school = await loadMonitorSchool(scope);
  const today = schoolToday(school, ctx.now);
  const from = query.from ?? `${(query.to ?? today).slice(0, 7)}-01`;
  const range = resolveRange(from, query.to, today, DEFAULT_RANGE_DAYS);
  if (!range) throw badRequest("VALIDATION_FAILED", "Rentang tanggal tidak valid (from <= to, maksimal 92 hari).");
  if (query.classId) await assertClassInSchool(scope, query.classId);
  const counts = countLateReasons(await lateReasonGroups(school.id, range, query.classId));
  return { ...range, ...counts };
}
