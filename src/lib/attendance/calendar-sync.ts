import type { SchoolTimezone } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import type { ActionContext } from "@/lib/auth/principal";
import type { DateRange } from "@/lib/calendar/ranges";
import type { Tx } from "@/lib/db";
import { fromDbDate, localParts, toDbDate, type LocalDate } from "@/lib/time/zone";
import { AUTO_ALPHA_JOB, holidayDates, reopenDates } from "./auto-alpha-rules";

/**
 * Perubahan kalender (libur sekolah/nasional) yang memengaruhi data absensi.
 * schoolId NULL = libur nasional (berlaku untuk semua sekolah).
 * ADDED   = rentang menjadi hari libur; REMOVED = libur dihapus;
 * CHANGED = libur diubah (from/to = gabungan rentang lama dan baru).
 */
export interface CalendarChange {
  readonly schoolId: string | null;
  readonly from: LocalDate;
  readonly to: LocalDate;
  readonly kind: "ADDED" | "REMOVED" | "CHANGED";
}

interface Range {
  readonly from: LocalDate;
  readonly to: LocalDate;
}

/** Baris turunan yang dibatalkan saat tanggal menjadi libur. CHECKIN & ADMIN selalu dipertahankan. */
const DERIVED_SOURCES = ["AUTO_ALPHA", "LEAVE"] as const;

/** Libur yang beririsan dengan rentang: sekolah + nasional, atau nasional saja (schoolId null). */
async function loadHolidays(tx: Tx, schoolId: string | null, range: Range): Promise<DateRange[]> {
  const rows = await tx.holiday.findMany({
    where: {
      OR: schoolId ? [{ schoolId }, { schoolId: null }] : [{ schoolId: null }],
      startDate: { lte: toDbDate(range.to) },
      endDate: { gte: toDbDate(range.from) },
    },
    select: { startDate: true, endDate: true },
  });
  return rows.map((row) => ({ startDate: fromDbDate(row.startDate), endDate: fromDbDate(row.endDate) }));
}

/** Hapus baris AUTO_ALPHA/LEAVE pada tanggal yang (kini) ditutup libur. Libur nasional: semua sekolah. */
async function deleteDerivedRows(tx: Tx, schoolId: string | null, dates: readonly LocalDate[]): Promise<number> {
  if (dates.length === 0) return 0;
  const { count } = await tx.attendance.deleteMany({
    where: { ...(schoolId ? { schoolId } : {}), date: { in: dates.map(toDbDate) }, source: { in: [...DERIVED_SOURCES] } },
  });
  return count;
}

async function deleteRuns(tx: Tx, schoolIds: readonly string[], dates: readonly LocalDate[]): Promise<number> {
  if (schoolIds.length === 0 || dates.length === 0) return 0;
  const { count } = await tx.jobRun.deleteMany({ where: { job: AUTO_ALPHA_JOB, scopeKey: { in: [...schoolIds] }, runKey: { in: [...dates] } } });
  return count;
}

/**
 * Buka ulang hari yang sudah ditutup (hapus JobRun auto-alpha) dalam jendela lookback 7 hari agar tick
 * berikutnya menutupnya lagi (ALPHA/LEAVE dipulihkan). Tanggal yang lebih lama perlu jalankan ulang manual.
 */
async function reopenClosedDays(tx: Tx, schoolId: string | null, range: Range, keep: ReadonlySet<LocalDate>, now: Date): Promise<number> {
  const schools = await tx.school.findMany({ where: schoolId ? { id: schoolId } : { isActive: true }, select: { id: true, timezone: true } });
  const byZone = new Map<SchoolTimezone, string[]>();
  for (const school of schools) byZone.set(school.timezone, [...(byZone.get(school.timezone) ?? []), school.id]);
  let reopened = 0;
  for (const [zone, ids] of byZone) reopened += await deleteRuns(tx, ids, reopenDates(range, localParts(now, zone).ymd, keep));
  return reopened;
}

/**
 * Dipanggil domain kalender DI DALAM transaksi yang sama dengan penulisan libur (setelah libur ditulis,
 * kunci `holidays:*` sudah dipegang). Desain 02 §3.8.6:
 * - ADDED/CHANGED: baris AUTO_ALPHA & LEAVE pada tanggal yang kini libur dihapus (CHECKIN/ADMIN tetap).
 * - REMOVED/CHANGED: JobRun auto-alpha tanggal yang tidak lagi libur (7 hari terakhir) dihapus.
 * Mengembalikan jumlah baris Attendance yang dihapus.
 */
export async function onCalendarChanged(tx: Tx, change: CalendarChange, ctx: ActionContext): Promise<{ affected: number }> {
  const range: Range = change.from <= change.to ? { from: change.from, to: change.to } : { from: change.to, to: change.from };
  const covered = holidayDates(range.from, range.to, await loadHolidays(tx, change.schoolId, range));
  const affected = change.kind === "REMOVED" ? 0 : await deleteDerivedRows(tx, change.schoolId, covered);
  const reopened = change.kind === "ADDED" ? 0 : await reopenClosedDays(tx, change.schoolId, range, new Set(covered), ctx.now);
  if (affected > 0 || reopened > 0) {
    await writeAudit(
      tx,
      {
        action: "attendance.calendar_sync",
        entityType: "Attendance",
        entityId: `${change.schoolId ?? "national"}:${range.from}..${range.to}`,
        schoolId: change.schoolId,
        after: { kind: change.kind, from: range.from, to: range.to, deletedRows: affected, reopenedDays: reopened },
      },
      ctx,
    );
  }
  return { affected };
}
