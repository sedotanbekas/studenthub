import type { AttendanceSource, AttendanceStatus } from "@prisma/client";
import { formatMinute, fromDbDate, localParts, type LocalDate, type SchoolTz } from "@/lib/time/zone";
import { HISTORY_MAX_MONTHS_BACK } from "./constants";
import type { HistoryDto, SummaryDto, TodayDto } from "./student-schemas";

/**
 * Pemetaan baris absensi -> DTO siswa dan statistik ringkas (murni, tanpa Prisma).
 * Persentase dihitung atas catatan di hari yang SUDAH DITUTUP (closedThrough) agar hari berjalan
 * tidak membuat persentase naik-turun sebelum auto-ALPHA menutup hari itu.
 */
export const ATTENDANCE_ROW_SELECT = {
  id: true,
  date: true,
  status: true,
  source: true,
  checkInAt: true,
  lateMinutes: true,
  distanceM: true,
  leaveRequestId: true,
} as const;

export interface AttendanceRow {
  readonly id: string;
  readonly date: Date;
  readonly status: AttendanceStatus;
  readonly source: AttendanceSource;
  readonly checkInAt: Date | null;
  readonly lateMinutes: number | null;
  readonly distanceM: number | null;
  readonly leaveRequestId: string | null;
}

export type CheckInAttendanceDto = {
  id: string;
  date: LocalDate;
  status: AttendanceStatus;
  lateMinutes: number | null;
  checkInAt: string;
  checkInTimeLocal: string;
  distanceM: number | null;
  source: AttendanceSource;
};

export type StatusCounts = Readonly<Record<AttendanceStatus, number>>;
export type HistoryDay = HistoryDto["days"][number];
export type MonthSummary = HistoryDto["summary"];
export type TermCounts = Omit<SummaryDto, "term" | "closedThrough">;

/** Jam lokal "HH:mm" dari instant server; null bila tidak ada. */
export function localTimeOf(instant: Date | null, tz: SchoolTz): string | null {
  return instant === null ? null : formatMinute(localParts(instant, tz).minuteOfDay);
}

export function toCheckInAttendanceDto(row: AttendanceRow, tz: SchoolTz): CheckInAttendanceDto {
  if (row.checkInAt === null) throw new Error("Baris CHECKIN tanpa checkInAt (melanggar chk_attendance_checkin)");
  return {
    id: row.id,
    date: fromDbDate(row.date),
    status: row.status,
    lateMinutes: row.lateMinutes,
    checkInAt: row.checkInAt.toISOString(),
    checkInTimeLocal: formatMinute(localParts(row.checkInAt, tz).minuteOfDay),
    distanceM: row.distanceM,
    source: row.source,
  };
}

export function toTodayRecord(row: AttendanceRow | null, tz: SchoolTz): TodayDto["record"] {
  if (row === null) return null;
  return { id: row.id, status: row.status, source: row.source, checkInTimeLocal: localTimeOf(row.checkInAt, tz), lateMinutes: row.lateMinutes };
}

export function toHistoryDay(row: AttendanceRow, tz: SchoolTz): HistoryDay {
  return {
    date: fromDbDate(row.date),
    status: row.status,
    source: row.source,
    checkInTimeLocal: localTimeOf(row.checkInAt, tz),
    lateMinutes: row.lateMinutes,
    leaveRequestId: row.leaveRequestId,
  };
}

const ZERO_COUNTS: StatusCounts = Object.freeze({ HADIR: 0, TERLAMBAT: 0, IZIN: 0, SAKIT: 0, ALPHA: 0 });

export function countStatuses(statuses: readonly AttendanceStatus[]): StatusCounts {
  return statuses.reduce<StatusCounts>((acc, status) => ({ ...acc, [status]: acc[status] + 1 }), ZERO_COUNTS);
}

/** Hasil groupBy(["status"]) -> hitungan lengkap (status tanpa baris = 0). */
export function countsFromGroups(groups: ReadonlyArray<{ status: AttendanceStatus; count: number }>): StatusCounts {
  return groups.reduce<StatusCounts>((acc, g) => ({ ...acc, [g.status]: acc[g.status] + g.count }), ZERO_COUNTS);
}

export const round1 = (value: number): number => Math.round(value * 10) / 10;

const totalOf = (c: StatusCounts): number => c.HADIR + c.TERLAMBAT + c.IZIN + c.SAKIT + c.ALPHA;

/** (HADIR + TERLAMBAT) / tercatat x 100, dibulatkan 1 desimal; null bila tidak ada catatan. */
export function presentPct(counts: StatusCounts): number | null {
  const recorded = totalOf(counts);
  return recorded === 0 ? null : round1(((counts.HADIR + counts.TERLAMBAT) / recorded) * 100);
}

export function monthSummary(counts: StatusCounts): MonthSummary {
  return {
    recorded: totalOf(counts),
    present: counts.HADIR + counts.TERLAMBAT,
    late: counts.TERLAMBAT,
    izin: counts.IZIN,
    sakit: counts.SAKIT,
    alpha: counts.ALPHA,
    presentPct: presentPct(counts),
  };
}

export function termCounts(counts: StatusCounts): TermCounts {
  return {
    recorded: totalOf(counts),
    hadir: counts.HADIR,
    terlambat: counts.TERLAMBAT,
    izin: counts.IZIN,
    sakit: counts.SAKIT,
    alpha: counts.ALPHA,
    presentPct: presentPct(counts),
  };
}

/** Tanggal terkecil dari dua tanggal lokal. */
export const minDate = (a: LocalDate, b: LocalDate): LocalDate => (a < b ? a : b);

const monthIndex = (month: string): number => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;

function monthFromIndex(index: number): string {
  const year = Math.floor(index / 12);
  return `${String(year).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** Bulan boleh dilihat: tidak di masa depan dan maks HISTORY_MAX_MONTHS_BACK bulan ke belakang. */
export function isHistoryMonthAllowed(month: string, currentMonth: string): boolean {
  const back = monthIndex(currentMonth) - monthIndex(month);
  return back >= 0 && back <= HISTORY_MAX_MONTHS_BACK;
}

export function monthNavigation(month: string, currentMonth: string): { prevMonth: string | null; nextMonth: string | null } {
  const prev = monthFromIndex(monthIndex(month) - 1);
  const next = monthFromIndex(monthIndex(month) + 1);
  return {
    prevMonth: isHistoryMonthAllowed(prev, currentMonth) ? prev : null,
    nextMonth: isHistoryMonthAllowed(next, currentMonth) ? next : null,
  };
}

/** Pesan sukses check-in untuk aplikasi siswa. */
export function checkInMessage(dto: Pick<CheckInAttendanceDto, "status" | "lateMinutes" | "checkInTimeLocal">, replayed: boolean): string {
  if (replayed) return `Anda sudah tercatat absen hari ini pukul ${dto.checkInTimeLocal}.`;
  if (dto.status === "TERLAMBAT") {
    return `Absensi berhasil. Anda tercatat Terlambat ${dto.lateMinutes ?? 0} menit (pukul ${dto.checkInTimeLocal}).`;
  }
  return `Absensi berhasil. Anda tercatat Hadir pukul ${dto.checkInTimeLocal}.`;
}
