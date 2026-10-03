import type { StudentStatus } from "@prisma/client";
import { weekdayBitOf } from "@/lib/calendar/rules";
import { DEFAULT_SCHOOL_CONFIG } from "@/lib/schools/rules";
import { instantAtLocal, localParts, type LocalDate, type SchoolTz } from "@/lib/time/zone";
import { isEligibleOn, type EligibilityPolicy } from "./auto-alpha-rules";

/**
 * Aturan murni pengingat absen (N5, keputusan pemilik 2026-10-03): kapan dikirim, sampai kapan berlaku, dan siapa
 * yang menerima. Tanpa Prisma; aman dipakai klien (pratinjau kartu pengaturan).
 */

export const ATTENDANCE_REMINDER_JOB = "attendance-reminder";
export const REMINDER_LEAD_MIN = 5;
export const REMINDER_LEAD_MAX = 120;
export const DEFAULT_REMINDER_LEAD_MINUTES = 15;

export interface ReminderSchedule {
  readonly timezone: SchoolTz;
  readonly checkInOpenMinute: number;
  readonly startMinute: number;
  readonly lateToleranceMinutes: number;
  readonly schoolDaysMask: number;
  readonly attendanceReminderLeadMinutes: number;
}

/** max(jam masuk - lead, jam buka absen); selalu < jam masuk karena buka < masuk (chk_school_schedule). */
export function reminderSendMinute(s: Pick<ReminderSchedule, "checkInOpenMinute" | "startMinute" | "attendanceReminderLeadMinutes">): number {
  return Math.max(s.startMinute - s.attendanceReminderLeadMinutes, s.checkInOpenMinute);
}

/** Batas "tercatat hadir" = jam masuk + toleransi terlambat: push setelahnya tidak berguna (kedaluwarsa). */
export function reminderExpiresAt(date: LocalDate, s: Pick<ReminderSchedule, "timezone" | "startMinute" | "lateToleranceMinutes">): Date {
  return instantAtLocal(date, s.startMinute + s.lateToleranceMinutes, s.timezone);
}

export const reminderKey = (date: LocalDate): string => `attendance-reminder:${date}`;

/**
 * Jendela kirim = [menit kirim, jam masuk - 1): baris yang ditulis di menit terakhir sebelum bel baru terkirim tick
 * berikutnya. Null bila hari itu bukan hari sekolah menurut mask atau di luar jendela (tanpa susulan).
 */
export function reminderSlot(now: Date, s: ReminderSchedule): { readonly date: LocalDate; readonly expiresAt: Date } | null {
  const local = localParts(now, s.timezone);
  if ((weekdayBitOf(local.ymd) & s.schoolDaysMask) === 0) return null;
  if (local.minuteOfDay < reminderSendMinute(s) || local.minuteOfDay >= s.startMinute - 1) return null;
  return { date: local.ymd, expiresAt: reminderExpiresAt(local.ymd, s) };
}

type ScheduleFields = "checkInOpenMinute" | "startMinute" | "lateToleranceMinutes" | "checkInCloseMinute" | "dayEndMinute" | "schoolDaysMask";
const SCHEDULE_FIELDS: readonly ScheduleFields[] = ["checkInOpenMinute", "startMinute", "lateToleranceMinutes", "checkInCloseMinute", "dayEndMinute", "schoolDaysMask"];

/** Jadwal masih bawaan (belum pernah diatur sekolah) -> jam masuk belum dikonfirmasi, pengingat tidak dikirim. */
export function isDefaultSchedule(s: Readonly<Record<ScheduleFields, number>>): boolean {
  return SCHEDULE_FIELDS.every((key) => s[key] === DEFAULT_SCHOOL_CONFIG[key]);
}

export interface ReminderCandidate {
  readonly id: string;
  readonly userId: string;
  readonly status: StudentStatus;
  readonly activatedAt: Date | null;
}

/** Izin PENDING atau DISETUJUI (keduanya membebaskan dari pengingat). */
export interface BlockingLeave {
  readonly studentId: string;
  readonly startDate: LocalDate;
  readonly endDate: LocalDate;
}

/** userId penerima (unik, urut): wajib absen, tidak ada izin yang mencakup tanggal, punya perangkat push. */
export function planReminderRecipients(date: LocalDate, candidates: readonly ReminderCandidate[], leaves: readonly BlockingLeave[], policy: EligibilityPolicy, reachable: ReadonlySet<string>): string[] {
  const onLeave = new Set(leaves.filter((l) => l.startDate <= date && date <= l.endDate).map((l) => l.studentId));
  const ids = candidates.filter((c) => isEligibleOn(c, date, policy) && !onLeave.has(c.id) && reachable.has(c.userId)).map((c) => c.userId);
  return [...new Set(ids)].sort();
}
