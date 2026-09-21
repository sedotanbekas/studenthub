import type { AttendanceStatus, JobRunStatus, LeaveType, StudentStatus } from "@prisma/client";
import type { DateRange } from "@/lib/calendar/ranges";
import { JOB_MAX_ATTEMPTS } from "@/lib/jobs/constants";
import { addDays, eachDate, instantAtLocal, localParts, type LocalDate, type SchoolTz } from "@/lib/time/zone";

/**
 * Aturan murni auto-ALPHA (desain 02 §3.7): tanggal kandidat penutupan hari, kelayakan siswa, dan
 * rencana baris yang ditulis saat hari sekolah ditutup. Tanpa Prisma; jam disuntik lewat `now`.
 */

/** Nama job pada JobRun (kunci: job + schoolId + tanggal lokal). Dipakai juga calendar-sync & maintenance. */
export const AUTO_ALPHA_JOB = "auto-alpha";
/** Hari ke belakang yang masih dikejar (catch-up) bila tick terlewat. */
export const AUTO_ALPHA_LOOKBACK_DAYS = 7;
/** Ukuran potongan createMany. */
export const AUTO_ALPHA_BATCH_SIZE = 500;

export interface CloseSchedule {
  readonly timezone: SchoolTz;
  readonly dayEndMinute: number;
  readonly createdAt: Date;
}

const laterOf = (a: LocalDate, b: LocalDate): LocalDate => (a > b ? a : b);

/**
 * Tanggal lokal terakhir yang sudah ditutup: hari ini bila menit lokal >= dayEndMinute, selain itu
 * kemarin. Satu-satunya definisi "hari tertutup" (dipakai auto-ALPHA, ringkasan siswa, & analitik admin).
 */
export function closedThrough(now: Date, tz: SchoolTz, dayEndMinute: number): LocalDate {
  const local = localParts(now, tz);
  return local.minuteOfDay >= dayEndMinute ? local.ymd : addDays(local.ymd, -1);
}
const earlierOf = (a: LocalDate, b: LocalDate): LocalDate => (a < b ? a : b);

/**
 * Tanggal lokal yang perlu ditutup, urut naik (terlama dulu): hari ini (hanya bila menit lokal >=
 * dayEndMinute) dan hingga 7 hari sebelumnya, tidak sebelum tanggal lokal createdAt sekolah, dan
 * belum selesai (`done`).
 */
export function candidateCloseDates(now: Date, school: CloseSchedule, done: ReadonlySet<LocalDate>): LocalDate[] {
  const local = localParts(now, school.timezone);
  const earliest = laterOf(localParts(school.createdAt, school.timezone).ymd, addDays(local.ymd, -AUTO_ALPHA_LOOKBACK_DAYS));
  const latest = closedThrough(now, school.timezone, school.dayEndMinute);
  return eachDate(earliest, latest).filter((date) => !done.has(date));
}

/** Semua runKey (tanggal) yang mungkin menjadi kandidat di zona mana pun: WIB hari ini - 7 s.d. WIT hari ini. */
export function lookbackRunKeys(now: Date): LocalDate[] {
  return eachDate(addDays(localParts(now, "WIB").ymd, -AUTO_ALPHA_LOOKBACK_DAYS), localParts(now, "WIT").ymd);
}

/** JobRun yang tidak perlu dicoba lagi: SUCCEEDED, atau FAILED yang kehabisan percobaan. */
export function isSettledRun(run: { readonly status: JobRunStatus; readonly attempts: number }): boolean {
  return run.status === "SUCCEEDED" || (run.status === "FAILED" && run.attempts >= JOB_MAX_ATTEMPTS);
}

export interface EligibilityInput {
  readonly status: StudentStatus;
  readonly activatedAt: Date | null;
}

/** Siswa ACTIVE yang tanggal lokal aktivasinya <= tanggal yang ditutup. */
export function isEligibleOn(student: EligibilityInput, date: LocalDate, tz: SchoolTz): boolean {
  return student.status === "ACTIVE" && student.activatedAt !== null && localParts(student.activatedAt, tz).ymd <= date;
}

/** Batas eksklusif activatedAt untuk kueri: awal hari lokal berikutnya. */
export function activatedBefore(date: LocalDate, tz: SchoolTz): Date {
  return instantAtLocal(addDays(date, 1), 0, tz);
}

export interface CloseCandidate extends EligibilityInput {
  readonly id: string;
  readonly currentClassId: string | null;
}

export interface CoveringLeave {
  readonly id: string;
  readonly studentId: string;
  readonly type: LeaveType;
  readonly startDate: LocalDate;
  readonly endDate: LocalDate;
}

export interface AttendanceDraft {
  readonly studentId: string;
  readonly classId: string | null;
  readonly status: AttendanceStatus;
  readonly source: "AUTO_ALPHA" | "LEAVE";
  readonly leaveRequestId: string | null;
}

const precedes = (a: CoveringLeave, b: CoveringLeave): boolean => a.startDate < b.startDate || (a.startDate === b.startDate && a.id < b.id);

/** Izin DISETUJUI per siswa yang mencakup tanggal (bila lebih dari satu: mulai paling awal, lalu id). */
function leavesCovering(date: LocalDate, leaves: readonly CoveringLeave[]): ReadonlyMap<string, CoveringLeave> {
  const byStudent = new Map<string, CoveringLeave>();
  for (const leave of leaves) {
    if (leave.startDate > date || leave.endDate < date) continue;
    const current = byStudent.get(leave.studentId);
    if (!current || precedes(leave, current)) byStudent.set(leave.studentId, leave);
  }
  return byStudent;
}

function draftFor(student: CloseCandidate, leave: CoveringLeave | undefined): AttendanceDraft {
  if (leave) return { studentId: student.id, classId: student.currentClassId, status: leave.type, source: "LEAVE", leaveRequestId: leave.id };
  return { studentId: student.id, classId: student.currentClassId, status: "ALPHA", source: "AUTO_ALPHA", leaveRequestId: null };
}

/**
 * Baris yang ditulis saat hari sekolah `date` ditutup. `candidates` = siswa tanpa baris Attendance
 * pada tanggal itu. Izin DISETUJUI yang mencakup tanggal -> LEAVE (IZIN/SAKIT); selain itu ALPHA.
 * Izin yang masih PENDING tidak melindungi (persetujuan kemudian mengonversi baris ALPHA).
 */
export function planDayClose(
  date: LocalDate,
  candidates: readonly CloseCandidate[],
  leaves: readonly CoveringLeave[],
  tz: SchoolTz,
): AttendanceDraft[] {
  const covering = leavesCovering(date, leaves);
  return candidates.filter((student) => isEligibleOn(student, date, tz)).map((student) => draftFor(student, covering.get(student.id)));
}

export function summarizeDrafts(drafts: readonly AttendanceDraft[]): { alpha: number; leave: number } {
  const leave = drafts.filter((draft) => draft.source === "LEAVE").length;
  return { alpha: drafts.length - leave, leave };
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new RangeError(`Ukuran potongan tidak valid: ${size}`);
  return Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
}

/** Tanggal dalam [from, to] yang ditutup minimal satu libur (rentang inklusif). */
export function holidayDates(from: LocalDate, to: LocalDate, holidays: readonly DateRange[]): LocalDate[] {
  return eachDate(from, to).filter((date) => holidays.some((h) => h.startDate <= date && date <= h.endDate));
}

/**
 * Tanggal yang JobRun auto-alpha-nya dibuka ulang setelah libur dihapus/dipersempit: irisan rentang
 * dengan jendela lookback [today - 7, today], kecuali tanggal yang masih libur (`keep`). Tanggal yang
 * lebih lama tidak dikejar tick lagi (perlu jalankan ulang manual).
 */
export function reopenDates(range: { readonly from: LocalDate; readonly to: LocalDate }, today: LocalDate, keep: ReadonlySet<LocalDate>): LocalDate[] {
  const from = laterOf(range.from, addDays(today, -AUTO_ALPHA_LOOKBACK_DAYS));
  return eachDate(from, earlierOf(range.to, today)).filter((date) => !keep.has(date));
}
