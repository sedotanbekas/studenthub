import type { Tx } from "@/lib/db";
import { closedThrough } from "@/lib/attendance/auto-alpha-rules";
import type { SchoolScope } from "@/lib/tenant/scope";
import { toDbDate } from "@/lib/time/zone";
import type { SchoolClock, TermRow } from "./context";
import { attendanceWindow, summarizeAttendanceByStudent, type AttendanceSummary } from "./rules";

/**
 * Rekap SAKIT/IZIN/ALPHA per siswa untuk satu semester: dari awal semester s.d. min(akhir semester,
 * hari tertutup terakhir sekolah). Hari berjalan yang belum ditutup (auto-ALPHA) tidak dihitung.
 */
const COUNTED_STATUSES = ["SAKIT", "IZIN", "ALPHA"] as const;

export async function termAttendanceByStudent(
  db: Tx,
  scope: SchoolScope,
  term: TermRow,
  clock: SchoolClock,
  studentIds: readonly string[],
  now: Date,
): Promise<ReadonlyMap<string, AttendanceSummary>> {
  const window = attendanceWindow(term.startDate, term.endDate, closedThrough(now, clock.timezone, clock.dayEndMinute));
  if (window === null || studentIds.length === 0) return new Map();
  const groups = await db.attendance.groupBy({
    by: ["studentId", "status"],
    where: {
      schoolId: scope.schoolId,
      studentId: { in: [...studentIds] },
      status: { in: [...COUNTED_STATUSES] },
      date: { gte: toDbDate(window.from), lte: toDbDate(window.to) },
    },
    _count: { _all: true },
  });
  return summarizeAttendanceByStudent(groups.map((g) => ({ studentId: g.studentId, status: g.status, count: g._count._all })));
}
