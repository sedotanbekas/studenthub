import type { AttendanceSource, AttendanceStatus } from "@prisma/client";
import type { RuleViolation } from "@/lib/calendar/ranges";
import { diffDays, type LocalDate } from "@/lib/time/zone";

/**
 * Aturan murni koreksi absensi oleh admin (desain 02 §3.9). Prioritas: koreksi admin > kehadiran > izin.
 * Bukti check-in (koordinat, selfie, perangkat, flag) tidak pernah diubah koreksi.
 */

/** Jendela koreksi admin sekolah (hari ke belakang dari hari ini lokal); super admin tanpa batas. */
export const CORRECTION_WINDOW_DAYS = 45;
export const CORRECTION_REASON_MIN = 5;
export const CORRECTION_REASON_MAX = 255;
export const LATE_MINUTES_MIN = 1;
export const LATE_MINUTES_MAX = 720;

export const ATTENDANCE_STATUSES = ["HADIR", "TERLAMBAT", "IZIN", "SAKIT", "ALPHA"] as const satisfies readonly AttendanceStatus[];
export const ATTENDANCE_SOURCES = ["CHECKIN", "LEAVE", "AUTO_ALPHA", "ADMIN"] as const satisfies readonly AttendanceSource[];

export interface CorrectionInput {
  readonly status: AttendanceStatus;
  readonly lateMinutes: number | null;
  readonly reason: string;
}

/** Pesan masalah lateMinutes (null bila valid): wajib 1..720 untuk TERLAMBAT, dilarang untuk status lain. */
export function lateMinutesProblem(status: AttendanceStatus, lateMinutes: number | null | undefined): string | null {
  const provided = lateMinutes !== null && lateMinutes !== undefined;
  if (status !== "TERLAMBAT") return provided ? "lateMinutes hanya boleh diisi untuk status TERLAMBAT." : null;
  if (!provided) return "lateMinutes wajib diisi untuk status TERLAMBAT.";
  const valid = Number.isInteger(lateMinutes) && lateMinutes >= LATE_MINUTES_MIN && lateMinutes <= LATE_MINUTES_MAX;
  return valid ? null : `lateMinutes harus bilangan bulat ${LATE_MINUTES_MIN}-${LATE_MINUTES_MAX}.`;
}

export interface CorrectionDateCheck {
  readonly date: LocalDate;
  /** Hari ini lokal sekolah. */
  readonly today: LocalDate;
  readonly isSchoolDay: boolean;
  /** true untuk SCHOOL_ADMIN (jendela 45 hari); SUPER_ADMIN false. */
  readonly windowLimited: boolean;
}

/** Urutan cek: masa depan -> hari sekolah -> jendela koreksi. */
export function validateCorrection(check: CorrectionDateCheck): RuleViolation | null {
  if (check.date > check.today) {
    return { code: "FUTURE_DATE", message: "Absensi tanggal yang akan datang tidak dapat dikoreksi." };
  }
  if (!check.isSchoolDay) {
    return { code: "NOT_SCHOOL_DAY", message: `Tanggal ${check.date} bukan hari sekolah.` };
  }
  if (check.windowLimited && diffDays(check.today, check.date) > CORRECTION_WINDOW_DAYS) {
    return {
      code: "CORRECTION_WINDOW_EXPIRED",
      message: `Admin sekolah hanya dapat mengoreksi absensi ${CORRECTION_WINDOW_DAYS} hari terakhir. Hubungi super admin.`,
    };
  }
  return null;
}

export interface AttendanceSnapshot {
  readonly status: AttendanceStatus;
  readonly source: AttendanceSource;
  readonly lateMinutes: number | null;
  readonly note: string | null;
}

export type CorrectionUpdate = Partial<{ status: AttendanceStatus; lateMinutes: number | null; source: AttendanceSource; note: string }>;

export type CorrectionPlan =
  | { readonly kind: "noop"; readonly before: AttendanceSnapshot }
  | { readonly kind: "create"; readonly before: null; readonly after: AttendanceSnapshot }
  | { readonly kind: "update"; readonly before: AttendanceSnapshot; readonly after: AttendanceSnapshot; readonly data: CorrectionUpdate };

/** Data UPDATE hanya berisi kolom yang nilainya berubah. */
function changedFields(before: AttendanceSnapshot, after: AttendanceSnapshot): CorrectionUpdate {
  return {
    ...(before.status === after.status ? {} : { status: after.status }),
    ...(before.lateMinutes === after.lateMinutes ? {} : { lateMinutes: after.lateMinutes }),
    ...(before.source === after.source ? {} : { source: after.source }),
    ...(before.note === after.note || after.note === null ? {} : { note: after.note }),
  };
}

/**
 * Rencana koreksi untuk baris (siswa, tanggal): tanpa baris -> create (source ADMIN); status dan
 * lateMinutes sama -> noop; selain itu update status/lateMinutes/source=ADMIN/note=alasan.
 */
export function buildCorrectionPatch(existing: AttendanceSnapshot | null, input: CorrectionInput): CorrectionPlan {
  const lateMinutes = input.status === "TERLAMBAT" ? input.lateMinutes : null;
  const after: AttendanceSnapshot = { status: input.status, source: "ADMIN", lateMinutes, note: input.reason };
  if (existing === null) return { kind: "create", before: null, after };
  if (existing.status === input.status && existing.lateMinutes === lateMinutes) return { kind: "noop", before: existing };
  return { kind: "update", before: existing, after, data: changedFields(existing, after) };
}
