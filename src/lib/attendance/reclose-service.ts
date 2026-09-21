import { assertNoViolation } from "@/lib/academics/guards";
import { writeAudit } from "@/lib/audit";
import type { ActionContext } from "@/lib/auth/principal";
import { prisma } from "@/lib/db";
import { notFound } from "@/lib/http/errors";
import { withTx } from "@/lib/tx";
import { CLOSE_SCHOOL_SELECT, closeDayLocked, markDayClosed, type DayCloseResult } from "./auto-alpha-job";
import { recloseViolation } from "./auto-alpha-rules";
import type { RecloseDayBody, RecloseDayDto } from "./admin-schemas";
import { lockCalendarShared } from "./calendar-locks";

/**
 * Tutup-ulang manual satu hari sekolah oleh super admin (desain 02 §3.7.8): untuk hari lampau yang datanya
 * hilang/berubah (mis. libur ditambah lalu dihapus, tick mati > 7 hari). Penutupan idempoten yang sama
 * dengan tick (kunci kalender bersama, anti-join + INSERT IGNORE, sapuan SHARED_DEVICE); JobRun auto-alpha
 * tanggal itu ditulis SUCCEEDED dan tindakan diaudit dalam transaksi yang sama.
 */
const RECLOSE_TX_TIMEOUT_MS = 60_000;

function toDto(schoolId: string, result: DayCloseResult): RecloseDayDto {
  if ("skipped" in result) {
    return { schoolId, date: result.date, isSchoolDay: false, skippedReason: result.reason, planned: 0, inserted: 0, alphaPlanned: 0, leavePlanned: 0, anomaliesSwept: 0 };
  }
  return { schoolId, isSchoolDay: true, skippedReason: null, ...result };
}

export async function recloseSchoolDay(input: RecloseDayBody, ctx: ActionContext): Promise<RecloseDayDto> {
  const school = await prisma.school.findUnique({ where: { id: input.schoolId }, select: CLOSE_SCHOOL_SELECT });
  if (!school) throw notFound("Sekolah tidak ditemukan.", "SCHOOL_NOT_FOUND");
  assertNoViolation(recloseViolation(input.date, school, ctx.now));
  const result = await withTx(
    async (tx) => {
      await lockCalendarShared(tx, school.id);
      const closed = await closeDayLocked(tx, school, input.date, ctx);
      await markDayClosed(tx, school.id, input.date, closed, ctx.now);
      await writeAudit(tx, { action: "attendance.reclose_day", entityType: "School", entityId: school.id, schoolId: school.id, after: closed }, ctx);
      return closed;
    },
    { timeout: RECLOSE_TX_TIMEOUT_MS },
  );
  return toDto(school.id, result);
}
