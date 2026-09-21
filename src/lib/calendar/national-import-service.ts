import { onCalendarChanged } from "@/lib/attendance/calendar-sync";
import { writeAudit } from "@/lib/audit";
import type { ActionContext } from "@/lib/auth/principal";
import type { Tx } from "@/lib/db";
import { fromDbDate, toDbDate } from "@/lib/time/zone";
import { lockKey, withTx } from "@/lib/tx";
import { HOLIDAY_SELECT, toHolidayDto } from "./dto";
import { holidayLockKey } from "./holiday-service";
import { planNationalHolidayImport, type NationalHolidayEntry } from "./national-import";

/**
 * Upsert idempoten libur nasional (schoolId NULL) dari berkas SKB: cocok berdasarkan
 * nama + tanggal mulai; hanya endDate yang diperbarui. Satu transaksi, audit per baris,
 * onCalendarChanged untuk setiap baris baru/berubah.
 */
export interface NationalImportResult {
  readonly created: number;
  readonly updated: number;
  readonly unchanged: number;
}

const IMPORT_TX_TIMEOUT_MS = 60_000;
const MAX_EXISTING_SCANNED = 5_000;

async function loadExisting(tx: Tx, entries: readonly NationalHolidayEntry[]) {
  const starts = entries.map((e) => e.startDate).sort();
  const rows = await tx.holiday.findMany({
    where: { schoolId: null, startDate: { gte: toDbDate(starts[0] ?? "2000-01-01"), lte: toDbDate(starts.at(-1) ?? "2000-01-01") } },
    select: HOLIDAY_SELECT,
    take: MAX_EXISTING_SCANNED,
  });
  return rows.map((row) => ({ id: row.id, name: row.name, startDate: fromDbDate(row.startDate), endDate: fromDbDate(row.endDate) }));
}

async function createEntry(tx: Tx, entry: NationalHolidayEntry, ctx: ActionContext): Promise<void> {
  const row = await tx.holiday.create({
    data: { schoolId: null, name: entry.name, startDate: toDbDate(entry.startDate), endDate: toDbDate(entry.endDate) },
    select: HOLIDAY_SELECT,
  });
  const after = { ...toHolidayDto(row), kind: entry.kind, source: entry.source };
  await writeAudit(tx, { action: "national_holiday.import", entityType: "Holiday", entityId: row.id, schoolId: null, after }, ctx);
  await onCalendarChanged(tx, { schoolId: null, from: entry.startDate, to: entry.endDate, kind: "ADDED" }, ctx);
}

async function updateEntry(tx: Tx, id: string, entry: NationalHolidayEntry, beforeEndDate: string, ctx: ActionContext): Promise<void> {
  await tx.holiday.update({ where: { id }, data: { endDate: toDbDate(entry.endDate) } });
  await writeAudit(
    tx,
    { action: "national_holiday.import", entityType: "Holiday", entityId: id, schoolId: null, before: { endDate: beforeEndDate }, after: { endDate: entry.endDate, source: entry.source } },
    ctx,
  );
  const to = entry.endDate > beforeEndDate ? entry.endDate : beforeEndDate;
  await onCalendarChanged(tx, { schoolId: null, from: entry.startDate, to, kind: "CHANGED" }, ctx);
}

export async function importNationalHolidays(entries: readonly NationalHolidayEntry[], ctx: ActionContext): Promise<NationalImportResult> {
  return withTx(
    async (tx) => {
      await lockKey(tx, holidayLockKey(null));
      const plan = planNationalHolidayImport(entries, await loadExisting(tx, entries));
      for (const entry of plan.create) await createEntry(tx, entry, ctx);
      for (const item of plan.update) await updateEntry(tx, item.id, item.entry, item.beforeEndDate, ctx);
      return { created: plan.create.length, updated: plan.update.length, unchanged: plan.unchanged };
    },
    { timeout: IMPORT_TX_TIMEOUT_MS },
  );
}
