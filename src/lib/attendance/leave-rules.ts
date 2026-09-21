import { inclusiveDays, rangesOverlap, type DateRange, type RuleViolation } from "@/lib/calendar/ranges";
import { addDays, instantAtLocal, localParts, type LocalDate, type SchoolTz } from "@/lib/time/zone";
import {
  LEAVE_ADMIN_MAX_BACKDATE_DAYS,
  LEAVE_MAX_ADVANCE_DAYS,
  LEAVE_MAX_BACKDATE_DAYS,
  LEAVE_MAX_SPAN_DAYS,
  SICK_NOTE_REQUIRED_MIN_SCHOOL_DAYS,
  type LeaveTypeValue,
} from "./leave-constants";

/**
 * Aturan murni izin/sakit (tanpa Prisma; "hari ini" disuntikkan pemanggil dari ctx.now + zona sekolah).
 * Service memetakan RuleViolation ke AppError: kode rentang & hari -> 422.
 *
 * Diekspor untuk domain absensi lain (auto-ALPHA, check-in):
 * - `leaveCoversDate(leave, date)` — apakah izin (rentang inklusif) mencakup tanggal lokal.
 * - `planLeaveMaterialization(days, existing)` — rencana baris absensi untuk izin yang disetujui.
 */
export type LeaveActor = "STUDENT" | "ADMIN";

export interface LeaveRangeInput extends DateRange {
  /** Tanggal lokal sekolah saat ini. */
  readonly today: LocalDate;
  readonly actor: LeaveActor;
}

/** Tanggal mulai paling awal: siswa hari ini - 7, admin hari ini - 30. */
export function earliestLeaveStart(today: LocalDate, actor: LeaveActor): LocalDate {
  return addDays(today, -(actor === "ADMIN" ? LEAVE_ADMIN_MAX_BACKDATE_DAYS : LEAVE_MAX_BACKDATE_DAYS));
}

/** Tanggal selesai paling akhir: hari ini + 30. */
export const latestLeaveEnd = (today: LocalDate): LocalDate => addDays(today, LEAVE_MAX_ADVANCE_DAYS);

/** Urutan cek: rentang terbalik -> terlalu panjang -> terlalu mundur -> terlalu maju. */
export function validateLeaveRange(input: LeaveRangeInput): RuleViolation | null {
  if (input.startDate > input.endDate) {
    return { code: "INVALID_DATE_RANGE", message: "Tanggal mulai tidak boleh setelah tanggal selesai." };
  }
  if (inclusiveDays(input) > LEAVE_MAX_SPAN_DAYS) {
    return { code: "LEAVE_TOO_LONG", message: `Rentang izin maksimal ${LEAVE_MAX_SPAN_DAYS} hari kalender.` };
  }
  const earliest = earliestLeaveStart(input.today, input.actor);
  if (input.startDate < earliest) {
    return { code: "LEAVE_BACKDATE_LIMIT", message: `Tanggal mulai paling awal ${earliest}.` };
  }
  const latest = latestLeaveEnd(input.today);
  if (input.endDate > latest) {
    return { code: "LEAVE_ADVANCE_LIMIT", message: `Tanggal selesai paling lambat ${latest}.` };
  }
  return null;
}

/** Jendela kuota pengajuan harian: awal hari lokal sekolah & sisa detik sampai hari berikutnya (Retry-After). */
export function leaveQuotaWindow(now: Date, tz: SchoolTz): { readonly from: Date; readonly retryAfterSeconds: number } {
  const today = localParts(now, tz).ymd;
  const next = instantAtLocal(addDays(today, 1), 0, tz);
  return { from: instantAtLocal(today, 0, tz), retryAfterSeconds: Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 1000)) };
}

/** SAKIT yang mencakup >= 3 hari sekolah wajib melampirkan foto. */
export function requiresAttachment(type: LeaveTypeValue, schoolDayCount: number): boolean {
  return type === "SAKIT" && schoolDayCount >= SICK_NOTE_REQUIRED_MIN_SCHOOL_DAYS;
}

export interface LeaveDaysInput {
  readonly type: LeaveTypeValue;
  readonly schoolDayCount: number;
  readonly hasAttachment: boolean;
}

/** Rentang wajib memuat >= 1 hari sekolah; SAKIT >= 3 hari sekolah wajib lampiran. */
export function checkLeaveDays(input: LeaveDaysInput): RuleViolation | null {
  if (input.schoolDayCount === 0) {
    return { code: "NO_SCHOOL_DAYS_IN_RANGE", message: "Rentang tanggal tidak memuat hari sekolah." };
  }
  if (requiresAttachment(input.type, input.schoolDayCount) && !input.hasAttachment) {
    return {
      code: "ATTACHMENT_REQUIRED",
      message: `Sakit ${SICK_NOTE_REQUIRED_MIN_SCHOOL_DAYS} hari sekolah atau lebih wajib melampirkan foto surat keterangan.`,
    };
  }
  return null;
}

/** Izin PENDING/APPROVED pertama yang beririsan (inklusif; rentang bersebelahan tidak beririsan). */
export function findOverlappingLeave<T extends DateRange>(range: DateRange, existing: readonly T[]): T | null {
  return existing.find((leave) => rangesOverlap(range, leave)) ?? null;
}

export function leaveCoversDate(leave: DateRange, date: LocalDate): boolean {
  return leave.startDate <= date && date <= leave.endDate;
}

/** Sumber baris absensi (sama dengan enum Prisma AttendanceSource; modul ini tetap murni). */
export type AttendanceSourceValue = "CHECKIN" | "LEAVE" | "AUTO_ALPHA" | "ADMIN";

export interface ExistingAttendance {
  readonly id: string;
  readonly date: LocalDate;
  readonly source: AttendanceSourceValue;
}

export const LEAVE_SKIP_REASONS = ["CHECKED_IN", "ADMIN_OVERRIDE", "ALREADY_LEAVE", "NOT_ENROLLED"] as const;
export type LeaveSkipReason = (typeof LEAVE_SKIP_REASONS)[number];

export interface LeavePlan {
  /** Hari sekolah tanpa baris -> buat baris LEAVE. */
  readonly create: LocalDate[];
  /** Baris AUTO_ALPHA -> konversi ke LEAVE (compare-and-set pada source). */
  readonly convert: { id: string; date: LocalDate }[];
  /** Baris yang dipertahankan: prioritas koreksi admin > kehadiran > izin (D9). */
  readonly skipped: { date: LocalDate; reason: LeaveSkipReason }[];
}

const SKIP_REASON: Readonly<Record<Exclude<AttendanceSourceValue, "AUTO_ALPHA">, LeaveSkipReason>> = {
  CHECKIN: "CHECKED_IN",
  ADMIN: "ADMIN_OVERRIDE",
  LEAVE: "ALREADY_LEAVE",
};

/**
 * Rencana materialisasi izin yang disetujui untuk setiap hari sekolah dalam rentang (lampau, hari ini,
 * dan mendatang — D10). Baris di luar `schoolDays` tidak disentuh. Keluaran terurut tanggal.
 * `enrolledFrom` = tanggal pertama siswa wajib absen (auto-alpha-rules.firstEligibleDate: tanggal aktivasi,
 * atau besoknya bila diaktifkan setelah jam tutup check-in): hari sebelumnya dilewati NOT_ENROLLED (sama
 * dengan eligibilitas auto-ALPHA, agar persentase kehadiran tidak menghitung hari sebelum siswa wajib absen).
 */
export function planLeaveMaterialization(
  schoolDays: readonly LocalDate[],
  existing: readonly ExistingAttendance[],
  enrolledFrom: LocalDate | null = null,
): LeavePlan {
  const byDate = new Map(existing.map((row) => [row.date, row] as const));
  const days = [...new Set(schoolDays)].sort();
  const create: LocalDate[] = [];
  const convert: { id: string; date: LocalDate }[] = [];
  const skipped: { date: LocalDate; reason: LeaveSkipReason }[] = [];
  for (const date of days) {
    const row = byDate.get(date);
    if (enrolledFrom !== null && date < enrolledFrom) skipped.push({ date, reason: "NOT_ENROLLED" });
    else if (!row) create.push(date);
    else if (row.source === "AUTO_ALPHA") convert.push({ id: row.id, date });
    else skipped.push({ date, reason: SKIP_REASON[row.source] });
  }
  return { create, convert, skipped };
}
