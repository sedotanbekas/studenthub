import type { Tx } from "@/lib/db";
import { closedThrough } from "@/lib/attendance/auto-alpha-rules";
import { listUnclosedDates } from "@/lib/attendance/closure-queries";
import { unprocessable } from "@/lib/http/errors";
import type { SchoolScope } from "@/lib/tenant/scope";
import { toDbDate, type LocalDate } from "@/lib/time/zone";
import type { SchoolClock, TermRow } from "./context";
import { attendanceWindow, summarizeAttendanceByStudent, type AttendanceSummary } from "./rules";

/**
 * Rekap SAKIT/IZIN/ALPHA per siswa untuk satu semester: dari awal semester s.d. min(akhir semester,
 * hari tertutup terakhir sekolah). Hari yang sudah lewat jam tutup tetapi belum ditutup auto-ALPHA
 * (tanpa JobRun SUCCEEDED: tick belum jalan / gagal / lewat jendela kejar) dilaporkan sebagai unclosedDates
 * — baris ALPHA hari itu bisa belum ada, sehingga rekap belum final dan tidak boleh dibekukan saat terbit.
 */
const COUNTED_STATUSES = ["SAKIT", "IZIN", "ALPHA"] as const;

export interface TermAttendance {
  readonly summaries: ReadonlyMap<string, AttendanceSummary>;
  /** Hari sekolah dalam rentang rekap yang belum ditutup auto-ALPHA (urut naik). */
  readonly unclosedDates: readonly LocalDate[];
}

const termWindow = (term: TermRow, clock: SchoolClock, now: Date) =>
  attendanceWindow(term.startDate, term.endDate, closedThrough(now, clock.timezone, clock.dayEndMinute));

/** Hari sekolah rentang rekap semester yang belum ditutup auto-ALPHA. */
export function termUnclosedDates(db: Tx, term: TermRow, clock: SchoolClock, now: Date): Promise<LocalDate[]> {
  return listUnclosedDates(db, clock, termWindow(term, clock, now), now);
}

export async function termAttendanceByStudent(
  db: Tx,
  scope: SchoolScope,
  term: TermRow,
  clock: SchoolClock,
  studentIds: readonly string[],
  now: Date,
): Promise<TermAttendance> {
  const window = termWindow(term, clock, now);
  if (window === null || studentIds.length === 0) return { summaries: new Map(), unclosedDates: [] };
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
  const summaries = summarizeAttendanceByStudent(groups.map((g) => ({ studentId: g.studentId, status: g.status, count: g._count._all })));
  return { summaries, unclosedDates: await listUnclosedDates(db, clock, window, now) };
}

/** Terbit membekukan rekap: hari yang belum ditutup -> 422 (coba lagi setelah tick, atau super admin menutup ulang). */
export function assertAttendanceClosed(unclosedDates: readonly LocalDate[]): void {
  if (unclosedDates.length === 0) return;
  throw unprocessable(
    "ATTENDANCE_NOT_CLOSED",
    `Rekap kehadiran belum final: ${unclosedDates.length} hari sekolah belum ditutup (auto-ALPHA). Coba lagi setelah hari itu ditutup, atau minta super admin menutup ulang hari tersebut.`,
    { unclosedDates },
  );
}
