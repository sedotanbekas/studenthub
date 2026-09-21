import type { SchoolTimezone } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import type { ActionContext } from "@/lib/auth/principal";
import type { DateRange } from "@/lib/calendar/ranges";
import type { Tx } from "@/lib/db";
import { fromDbDate, localParts, toDbDate, type LocalDate } from "@/lib/time/zone";
import { CLOSE_SCHOOL_SELECT, closeDayLocked, markDayClosed, type CloseSchool } from "./auto-alpha-job";
import { AUTO_ALPHA_JOB, chunk, holidayDates, reopenDates, staleCloseDates } from "./auto-alpha-rules";

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

interface Restored {
  readonly reopened: number;
  readonly reclosedDays: number;
  readonly reclosedRows: number;
}

/** Baris turunan yang dibatalkan saat tanggal menjadi libur. CHECKIN & ADMIN selalu dipertahankan. */
const DERIVED_SOURCES = ["AUTO_ALPHA", "LEAVE"] as const;
/** Sekolah per DELETE libur nasional (range scan indeks [schoolId, date, ...], tanpa scan seluruh tabel). */
const SCHOOL_DELETE_CHUNK = 50;
const MAX_HOLIDAYS_SCANNED = 2_000;

const normalize = (change: CalendarChange): Range => (change.from <= change.to ? { from: change.from, to: change.to } : { from: change.to, to: change.from });

function spanOf(ranges: readonly Range[]): Range {
  const from = ranges.reduce((min, r) => (r.from < min ? r.from : min), ranges[0]?.from ?? "");
  const to = ranges.reduce((max, r) => (r.to > max ? r.to : max), ranges[0]?.to ?? "");
  return { from, to };
}

/** Libur yang beririsan dengan rentang: sekolah + nasional, atau nasional saja (schoolId null). */
async function loadHolidays(tx: Tx, schoolId: string | null, range: Range): Promise<DateRange[]> {
  const rows = await tx.holiday.findMany({
    where: {
      OR: schoolId ? [{ schoolId }, { schoolId: null }] : [{ schoolId: null }],
      startDate: { lte: toDbDate(range.to) },
      endDate: { gte: toDbDate(range.from) },
    },
    select: { startDate: true, endDate: true },
    take: MAX_HOLIDAYS_SCANNED,
  });
  return rows.map((row) => ({ startDate: fromDbDate(row.startDate), endDate: fromDbDate(row.endDate) }));
}

/**
 * Hapus baris AUTO_ALPHA/LEAVE pada tanggal yang (kini) ditutup libur. Libur nasional: SEMUA sekolah, tetapi
 * per potongan schoolId (desain 02 §3.8.6) agar DELETE memakai indeks [schoolId, date, ...] dan hanya
 * mengunci baris tanggal itu — bukan scan (dan kunci) seluruh tabel Attendance lintas sekolah.
 */
async function deleteDerivedRows(tx: Tx, schoolId: string | null, dates: readonly LocalDate[]): Promise<number> {
  if (dates.length === 0) return 0;
  const schoolIds = schoolId ? [schoolId] : (await tx.school.findMany({ select: { id: true }, orderBy: { id: "asc" } })).map((row) => row.id);
  const where = { date: { in: dates.map(toDbDate) }, source: { in: [...DERIVED_SOURCES] } };
  let deleted = 0;
  for (const part of chunk(schoolIds, SCHOOL_DELETE_CHUNK)) {
    // Pilih id lewat indeks dulu (baca biasa di READ COMMITTED tanpa kunci), lalu DELETE per primary key:
    // hanya baris target yang dikunci, apa pun rencana query optimizer (DB kecil bisa memilih full scan).
    const rows = await tx.attendance.findMany({ where: { schoolId: { in: part }, ...where }, select: { id: true } });
    if (rows.length === 0) continue;
    const ids = rows.map((row) => row.id);
    deleted += (await tx.attendance.deleteMany({ where: { id: { in: ids }, source: { in: [...DERIVED_SOURCES] } } })).count;
  }
  return deleted;
}

async function deleteRuns(tx: Tx, schoolIds: readonly string[], dates: readonly LocalDate[]): Promise<number> {
  if (schoolIds.length === 0 || dates.length === 0) return 0;
  const { count } = await tx.jobRun.deleteMany({ where: { job: AUTO_ALPHA_JOB, scopeKey: { in: [...schoolIds] }, runKey: { in: [...dates] } } });
  return count;
}

const unionDates = (lists: ReadonlyArray<readonly LocalDate[]>): LocalDate[] => [...new Set(lists.flat())].sort();

/** Jendela lookback: hapus JobRun auto-alpha tanggal yang tidak lagi libur agar tick berikutnya menutupnya lagi. */
async function reopenRecentDays(tx: Tx, schools: readonly CloseSchool[], ranges: readonly Range[], keep: ReadonlySet<LocalDate>, now: Date): Promise<number> {
  const byZone = new Map<SchoolTimezone, string[]>();
  for (const school of schools) byZone.set(school.timezone, [...(byZone.get(school.timezone) ?? []), school.id]);
  let reopened = 0;
  for (const [zone, ids] of byZone) {
    const today = localParts(now, zone).ymd;
    reopened += await deleteRuns(tx, ids, unionDates(ranges.map((range) => reopenDates(range, today, keep))));
  }
  return reopened;
}

/**
 * Di luar jendela lookback tick tidak pernah kembali: tanggal yang tidak lagi libur ditutup ULANG langsung
 * di transaksi ini (kunci libur sudah dipegang pemanggil) dan dicatat sebagai JobRun SUCCEEDED.
 */
async function recloseStaleDays(tx: Tx, school: CloseSchool, ranges: readonly Range[], keep: ReadonlySet<LocalDate>, ctx: ActionContext) {
  const today = localParts(ctx.now, school.timezone).ymd;
  const earliest = localParts(school.createdAt, school.timezone).ymd;
  const dates = unionDates(ranges.map((range) => staleCloseDates(range, today, keep, earliest)));
  let rows = 0;
  for (const date of dates) {
    const result = await closeDayLocked(tx, school, date, ctx);
    await markDayClosed(tx, school.id, date, result, ctx.now);
    rows += "inserted" in result ? result.inserted : 0;
  }
  return { days: dates.length, rows };
}

/** REMOVED/CHANGED: hari lampau yang tidak lagi libur dipulihkan (reopen dalam lookback, tutup ulang di luarnya). */
async function restoreUncoveredDays(tx: Tx, schoolId: string | null, ranges: readonly Range[], keep: ReadonlySet<LocalDate>, ctx: ActionContext): Promise<Restored> {
  const schools = await tx.school.findMany({ where: schoolId ? { id: schoolId } : { isActive: true }, select: CLOSE_SCHOOL_SELECT, orderBy: { id: "asc" } });
  const reopened = await reopenRecentDays(tx, schools, ranges, keep, ctx.now);
  let reclosedDays = 0;
  let reclosedRows = 0;
  for (const school of schools.filter((s) => s.isActive)) {
    const result = await recloseStaleDays(tx, school, ranges, keep, ctx);
    reclosedDays += result.days;
    reclosedRows += result.rows;
  }
  return { reopened, reclosedDays, reclosedRows };
}

/**
 * Dipanggil domain kalender DI DALAM transaksi yang sama dengan penulisan libur (setelah libur ditulis,
 * kunci `holidays:*` sudah dipegang). Desain 02 §3.8.6:
 * - ADDED/CHANGED: baris AUTO_ALPHA & LEAVE pada tanggal yang kini libur dihapus (CHECKIN/ADMIN tetap).
 * - REMOVED/CHANGED: tanggal lampau yang tidak lagi libur dipulihkan — JobRun 7 hari terakhir dihapus
 *   (tick menutup ulang), tanggal yang lebih lama ditutup ulang langsung (ALPHA/LEAVE kembali).
 * Semua perubahan satu panggilan WAJIB ber-schoolId sama (impor nasional = satu panggilan per impor).
 * Mengembalikan jumlah baris Attendance yang dihapus.
 */
export async function onCalendarChanges(tx: Tx, changes: readonly CalendarChange[], ctx: ActionContext): Promise<{ affected: number }> {
  if (changes.length === 0) return { affected: 0 };
  const schoolId = changes[0]?.schoolId ?? null;
  if (changes.some((change) => change.schoolId !== schoolId)) throw new Error("onCalendarChanges: schoolId setiap perubahan wajib sama");
  const ranges = changes.map(normalize);
  const span = spanOf(ranges);
  const holidays = await loadHolidays(tx, schoolId, span);
  const covered = new Set(holidayDates(span.from, span.to, holidays));
  const coveredIn = (range: Range) => [...covered].filter((date) => range.from <= date && date <= range.to);
  const deleting = unionDates(changes.flatMap((change, i) => (change.kind === "REMOVED" ? [] : [coveredIn(ranges[i] as Range)])));
  const affected = await deleteDerivedRows(tx, schoolId, deleting);
  const restoring = ranges.filter((_, i) => changes[i]?.kind !== "ADDED");
  const restored: Restored = restoring.length > 0 ? await restoreUncoveredDays(tx, schoolId, restoring, covered, ctx) : { reopened: 0, reclosedDays: 0, reclosedRows: 0 };
  await auditSync(tx, schoolId, changes, span, { affected, ...restored }, ctx);
  return { affected };
}

/** Satu perubahan kalender (CRUD libur). */
export function onCalendarChanged(tx: Tx, change: CalendarChange, ctx: ActionContext): Promise<{ affected: number }> {
  return onCalendarChanges(tx, [change], ctx);
}

async function auditSync(
  tx: Tx,
  schoolId: string | null,
  changes: readonly CalendarChange[],
  span: Range,
  counts: Restored & { readonly affected: number },
  ctx: ActionContext,
): Promise<void> {
  if (counts.affected === 0 && counts.reopened === 0 && counts.reclosedDays === 0) return;
  const kinds = [...new Set(changes.map((change) => change.kind))];
  await writeAudit(
    tx,
    {
      action: "attendance.calendar_sync",
      entityType: "Attendance",
      entityId: `${schoolId ?? "national"}:${span.from}..${span.to}`,
      schoolId,
      after: {
        kind: kinds.length === 1 ? kinds[0] : kinds,
        from: span.from,
        to: span.to,
        changes: changes.length,
        deletedRows: counts.affected,
        reopenedDays: counts.reopened,
        reclosedDays: counts.reclosedDays,
        reclosedRows: counts.reclosedRows,
      },
    },
    ctx,
  );
}
