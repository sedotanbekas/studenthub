import { loadCalendarContext } from "@/lib/calendar/queries";
import { listSchoolDays } from "@/lib/calendar/rules";
import type { Tx } from "@/lib/db";
import { localParts, type LocalDate, type SchoolTz } from "@/lib/time/zone";
import { AUTO_ALPHA_JOB, closureTrackedFrom } from "./auto-alpha-rules";

/**
 * Status penutupan hari (auto-ALPHA) untuk agregasi kehadiran: hari sekolah yang sudah lewat jam tutup
 * (closedThrough) belum tentu sudah ditulis baris ALPHA-nya — job per tick bisa belum jalan, gagal
 * (FAILED setelah percobaan habis), atau lewat jendela kejar 7 hari. Dipakai analitik admin & rapor.
 */
export interface ClosureSchool {
  readonly id: string;
  readonly timezone: SchoolTz;
  readonly schoolDaysMask: number;
  /** Sekolah terdaftar (hari sebelumnya tidak pernah ditutup auto-ALPHA). */
  readonly createdAt: Date;
}

export interface DatePeriod {
  readonly from: LocalDate;
  readonly to: LocalDate;
}

/**
 * Hari sekolah di periode tanpa JobRun auto-alpha SUCCEEDED (data bisa belum lengkap). Hanya hari yang
 * status tutupnya bisa diketahui (closureTrackedFrom: setelah sekolah terdaftar, dalam retensi JobRun).
 * Pemanggil memotong periode di closedThrough terlebih dahulu.
 */
export async function listUnclosedDates(db: Tx, school: ClosureSchool, period: DatePeriod | null, now: Date): Promise<LocalDate[]> {
  if (!period) return [];
  const tracked = closureTrackedFrom(localParts(now, school.timezone).ymd, localParts(school.createdAt, school.timezone).ymd);
  const from = period.from > tracked ? period.from : tracked;
  if (from > period.to) return [];
  const days = listSchoolDays(from, period.to, await loadCalendarContext(db, school, { from, to: period.to }));
  if (days.length === 0) return [];
  const done = await db.jobRun.findMany({
    where: { job: AUTO_ALPHA_JOB, scopeKey: school.id, runKey: { in: days }, status: "SUCCEEDED" },
    select: { runKey: true },
    take: days.length,
  });
  const doneKeys = new Set(done.map((run) => run.runKey));
  return days.filter((day) => !doneKeys.has(day));
}
