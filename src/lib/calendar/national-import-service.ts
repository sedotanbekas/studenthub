import { onCalendarChanges, type CalendarChange } from "@/lib/attendance/calendar-sync";
import { writeAudit } from "@/lib/audit";
import type { ActionContext } from "@/lib/auth/principal";
import type { Tx } from "@/lib/db";
import { holidaysLockKey } from "@/lib/lock-keys";
import { fromDbDate, toDbDate } from "@/lib/time/zone";
import { lockKey, withTx } from "@/lib/tx";
import { HOLIDAY_SELECT, toHolidayDto } from "./dto";
import {
  importYearsOf,
  planNationalHolidayImport,
  type ExistingNationalHoliday,
  type NationalHolidayEntry,
  type NationalImportOptions,
  type SkippedImportYear,
} from "./national-import";

/**
 * Impor libur nasional (schoolId NULL) dari berkas SKB dalam satu transaksi di bawah kunci
 * `holidays:national` (sama dengan CRUD /platform/holidays), audit per baris, lalu SATU sinkronisasi
 * absensi (onCalendarChanges) atas gabungan rentang baris baru/berubah — tetap di bawah kunci yang sama
 * (penutupan hari auto-ALPHA mengandalkan urutan ini) tetapi waktu kunci dipegang tidak lagi N x DELETE.
 * Default: tahun yang SUDAH punya libur nasional dilewati seluruhnya (hasil edit/hapus super admin
 * tidak dihidupkan lagi); tahun kosong dibuat semua. `force`: cocok nama + tanggal mulai, hanya endDate
 * yang diperbarui (perilaku lama).
 */
export interface NationalImportResult {
  readonly created: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly skippedYears: readonly SkippedImportYear[];
}

const IMPORT_TX_TIMEOUT_MS = 60_000;
const MAX_EXISTING_SCANNED = 5_000;

/** Semua libur nasional pada tahun-tahun yang dicakup entri (penentu tahun terisi & pasangan --force). */
async function loadExisting(tx: Tx, entries: readonly NationalHolidayEntry[]): Promise<ExistingNationalHoliday[]> {
  const years = importYearsOf(entries);
  if (years.length === 0) return [];
  const rows = await tx.holiday.findMany({
    where: { schoolId: null, OR: years.map((y) => ({ startDate: { gte: toDbDate(`${y}-01-01`), lte: toDbDate(`${y}-12-31`) } })) },
    select: HOLIDAY_SELECT,
    orderBy: { startDate: "asc" },
    take: MAX_EXISTING_SCANNED,
  });
  return rows.map((row) => ({ id: row.id, name: row.name, startDate: fromDbDate(row.startDate), endDate: fromDbDate(row.endDate) }));
}

async function createEntry(tx: Tx, entry: NationalHolidayEntry, ctx: ActionContext): Promise<CalendarChange> {
  const row = await tx.holiday.create({
    data: { schoolId: null, name: entry.name, startDate: toDbDate(entry.startDate), endDate: toDbDate(entry.endDate) },
    select: HOLIDAY_SELECT,
  });
  const after = { ...toHolidayDto(row), kind: entry.kind, source: entry.source };
  await writeAudit(tx, { action: "national_holiday.import", entityType: "Holiday", entityId: row.id, schoolId: null, after }, ctx);
  return { schoolId: null, from: entry.startDate, to: entry.endDate, kind: "ADDED" };
}

async function updateEntry(tx: Tx, id: string, entry: NationalHolidayEntry, beforeEndDate: string, ctx: ActionContext): Promise<CalendarChange> {
  await tx.holiday.update({ where: { id }, data: { endDate: toDbDate(entry.endDate) } });
  await writeAudit(
    tx,
    { action: "national_holiday.import", entityType: "Holiday", entityId: id, schoolId: null, before: { endDate: beforeEndDate }, after: { endDate: entry.endDate, source: entry.source } },
    ctx,
  );
  const to = entry.endDate > beforeEndDate ? entry.endDate : beforeEndDate;
  return { schoolId: null, from: entry.startDate, to, kind: "CHANGED" };
}

export async function importNationalHolidays(
  entries: readonly NationalHolidayEntry[],
  ctx: ActionContext,
  options: NationalImportOptions = {},
): Promise<NationalImportResult> {
  return withTx(
    async (tx) => {
      await lockKey(tx, holidaysLockKey(null));
      const plan = planNationalHolidayImport(entries, await loadExisting(tx, entries), options);
      const changes: CalendarChange[] = [];
      for (const entry of plan.create) changes.push(await createEntry(tx, entry, ctx));
      for (const item of plan.update) changes.push(await updateEntry(tx, item.id, item.entry, item.beforeEndDate, ctx));
      await onCalendarChanges(tx, changes, ctx);
      return { created: plan.create.length, updated: plan.update.length, unchanged: plan.unchanged, skippedYears: plan.skippedYears };
    },
    { timeout: IMPORT_TX_TIMEOUT_MS },
  );
}
