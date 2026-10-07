import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { localParts, TZ_OFFSET_MINUTES } from "@/lib/time/zone";
import { collectionRate, periodOfKey, type ChildLevel, type PeriodWindow, type ScopeFilter } from "./rules";

/**
 * Agregat SPP per lingkup (SQL mentah, satu pemindaian per kelompok). Kategori tiap tagihan (selain VOID):
 * ON_TIME = lunas pada/ sebelum jatuh tempo (tanggal lokal sekolah), LATE = lunas setelahnya, OVERDUE = belum
 * lunas & jatuh tempo sudah lewat (hari ini lokal sekolah), NOT_DUE = belum lunas & belum jatuh tempo.
 * Tanggal "hari ini" per zona dikirim sebagai parameter (tanpa NOW() di SQL).
 */
type NumberLike = unknown;
const num = (value: NumberLike): number => (value === null || value === undefined ? 0 : Number(value));

export interface Buckets {
  readonly onTime: { count: number; amount: number };
  readonly late: { count: number; amount: number };
  readonly overdue: { count: number; amount: number };
  readonly notDue: { count: number; amount: number };
  readonly billed: number;
  readonly paid: number;
  readonly outstanding: number;
  readonly collectionRate: number | null;
}

interface BucketRow {
  onTimeCount: NumberLike; onTimeAmount: NumberLike; lateCount: NumberLike; lateAmount: NumberLike;
  overdueCount: NumberLike; overdueAmount: NumberLike; notDueCount: NumberLike; notDueAmount: NumberLike;
  billed: NumberLike; paid: NumberLike; students: NumberLike; overdueStudents: NumberLike; lateStudents: NumberLike;
}

const OFFSET = Prisma.sql`(CASE s.\`timezone\` WHEN 'WITA' THEN ${TZ_OFFSET_MINUTES.WITA} WHEN 'WIT' THEN ${TZ_OFFSET_MINUTES.WIT} ELSE ${TZ_OFFSET_MINUTES.WIB} END)`;

function categorySql(now: Date): Prisma.Sql {
  const today = Prisma.sql`(CASE s.\`timezone\` WHEN 'WITA' THEN ${localParts(now, "WITA").ymd} WHEN 'WIT' THEN ${localParts(now, "WIT").ymd} ELSE ${localParts(now, "WIB").ymd} END)`;
  const paidLocal = Prisma.sql`DATE(DATE_ADD(COALESCE(i.\`paidAt\`, i.\`updatedAt\`), INTERVAL ${OFFSET} MINUTE))`;
  return Prisma.sql`CASE
    WHEN i.\`status\` = 'PAID' AND ${paidLocal} <= i.\`dueDate\` THEN 'ON_TIME'
    WHEN i.\`status\` = 'PAID' THEN 'LATE'
    WHEN i.\`dueDate\` < ${today} THEN 'OVERDUE'
    ELSE 'NOT_DUE' END`;
}

function scopeWhere(scope: ScopeFilter): Prisma.Sql {
  if (scope.schoolId) return Prisma.sql`AND s.\`id\` = ${scope.schoolId}`;
  if (scope.cityCode) return Prisma.sql`AND s.\`cityCode\` = ${scope.cityCode}`;
  if (scope.provinceCode) return Prisma.sql`AND s.\`provinceCode\` = ${scope.provinceCode}`;
  return Prisma.empty;
}

/** Tagihan lingkup + kategori + kolom kelompok, sebagai tabel turunan `x`. */
function source(scope: ScopeFilter, window: PeriodWindow, now: Date): Prisma.Sql {
  return Prisma.sql`(
    SELECT i.\`studentId\`, i.\`amount\`, i.\`paidAmount\`, i.\`dueDate\`, (i.\`periodYear\` * 12 + i.\`periodMonth\` - 1) AS periodKey,
      s.\`id\` AS schoolId, s.\`name\` AS schoolName, s.\`provinceCode\`, s.\`cityCode\`, st.\`currentClassId\`, ${categorySql(now)} AS cat
    FROM \`Invoice\` i
      JOIN \`School\` s ON s.\`id\` = i.\`schoolId\`
      JOIN \`Student\` st ON st.\`id\` = i.\`studentId\`
    WHERE i.\`status\` <> 'VOID' AND i.\`voidedAt\` IS NULL
      AND (i.\`periodYear\` * 12 + i.\`periodMonth\` - 1) BETWEEN ${window.fromKey} AND ${window.toKey}
      ${scopeWhere(scope)}
  ) x`;
}

const BUCKET_COLUMNS = Prisma.sql`
  SUM(x.cat = 'ON_TIME') AS onTimeCount, SUM(IF(x.cat = 'ON_TIME', x.amount, 0)) AS onTimeAmount,
  SUM(x.cat = 'LATE') AS lateCount, SUM(IF(x.cat = 'LATE', x.amount, 0)) AS lateAmount,
  SUM(x.cat = 'OVERDUE') AS overdueCount, SUM(IF(x.cat = 'OVERDUE', x.amount - x.paidAmount, 0)) AS overdueAmount,
  SUM(x.cat = 'NOT_DUE') AS notDueCount, SUM(IF(x.cat = 'NOT_DUE', x.amount - x.paidAmount, 0)) AS notDueAmount,
  SUM(x.amount) AS billed, SUM(x.paidAmount) AS paid,
  COUNT(DISTINCT x.studentId) AS students,
  COUNT(DISTINCT IF(x.cat = 'OVERDUE', x.studentId, NULL)) AS overdueStudents,
  COUNT(DISTINCT IF(x.cat = 'LATE', x.studentId, NULL)) AS lateStudents`;

export function toBuckets(row: Partial<BucketRow> | undefined): Buckets {
  const billed = num(row?.billed);
  const paid = num(row?.paid);
  return {
    onTime: { count: num(row?.onTimeCount), amount: num(row?.onTimeAmount) },
    late: { count: num(row?.lateCount), amount: num(row?.lateAmount) },
    overdue: { count: num(row?.overdueCount), amount: num(row?.overdueAmount) },
    notDue: { count: num(row?.notDueCount), amount: num(row?.notDueAmount) },
    billed, paid, outstanding: billed - paid, collectionRate: collectionRate(paid, billed),
  };
}

export interface Totals extends Buckets { readonly invoices: number; readonly students: number; readonly overdueStudents: number; readonly lateStudents: number }

export async function totalsOf(scope: ScopeFilter, window: PeriodWindow, now: Date): Promise<Totals> {
  const [row] = await prisma.$queryRaw<(BucketRow & { invoices: NumberLike })[]>`SELECT ${BUCKET_COLUMNS}, COUNT(*) AS invoices FROM ${source(scope, window, now)}`;
  return { ...toBuckets(row), invoices: num(row?.invoices), students: num(row?.students), overdueStudents: num(row?.overdueStudents), lateStudents: num(row?.lateStudents) };
}

export async function trendOf(scope: ScopeFilter, window: PeriodWindow, now: Date): Promise<(Buckets & { period: string })[]> {
  const rows = await prisma.$queryRaw<(BucketRow & { periodKey: NumberLike })[]>`SELECT x.periodKey, ${BUCKET_COLUMNS} FROM ${source(scope, window, now)} GROUP BY x.periodKey`;
  const byKey = new Map(rows.map((row) => [num(row.periodKey), row]));
  return Array.from({ length: window.toKey - window.fromKey + 1 }, (_, i) => ({ period: periodOfKey(window.fromKey + i), ...toBuckets(byKey.get(window.fromKey + i)) }));
}

/** Kolom kunci & label per tingkat rincian (daftar tetap; tidak pernah dari input pengguna). */
const CHILD_SQL: Readonly<Record<ChildLevel, { key: Prisma.Sql; label: Prisma.Sql; join: Prisma.Sql }>> = {
  province: { key: Prisma.sql`x.\`provinceCode\``, label: Prisma.sql`MAX(p.\`name\`)`, join: Prisma.sql`JOIN \`Province\` p ON p.\`code\` = x.\`provinceCode\`` },
  city: { key: Prisma.sql`x.\`cityCode\``, label: Prisma.sql`MAX(c.\`name\`)`, join: Prisma.sql`JOIN \`City\` c ON c.\`code\` = x.\`cityCode\`` },
  school: { key: Prisma.sql`x.schoolId`, label: Prisma.sql`MAX(x.schoolName)`, join: Prisma.empty },
  class: { key: Prisma.sql`COALESCE(x.\`currentClassId\`, '-')`, label: Prisma.sql`COALESCE(MAX(k.\`name\`), 'Tanpa kelas')`, join: Prisma.sql`LEFT JOIN \`SchoolClass\` k ON k.\`id\` = x.\`currentClassId\`` },
};

export interface BreakdownRow extends Buckets { readonly key: string; readonly label: string; readonly students: number; readonly overdueStudents: number }

export async function breakdownOf(scope: ScopeFilter, child: ChildLevel, window: PeriodWindow, now: Date): Promise<BreakdownRow[]> {
  const c = CHILD_SQL[child];
  const rows = await prisma.$queryRaw<(BucketRow & { k: string; label: string })[]>`
    SELECT ${c.key} AS k, ${c.label} AS label, ${BUCKET_COLUMNS}
    FROM ${source(scope, window, now)} ${c.join}
    GROUP BY ${c.key}
    ORDER BY overdueAmount DESC, billed DESC
    LIMIT 200`;
  return rows.map((row) => ({ key: String(row.k), label: String(row.label), ...toBuckets(row), students: num(row.students), overdueStudents: num(row.overdueStudents) }));
}

export interface ArrearsStudent {
  readonly studentId: string; readonly name: string; readonly nisn: string; readonly className: string | null; readonly schoolName: string;
  readonly overdueInvoices: number; readonly outstanding: number; readonly oldestDueDate: string | null; readonly lateInvoices: number;
}

/** Siswa menunggak / pernah telat (maks 50), sisa tunggakan terbesar dulu. */
export async function arrearsStudents(scope: ScopeFilter, window: PeriodWindow, now: Date): Promise<ArrearsStudent[]> {
  const rows = await prisma.$queryRaw<Record<string, NumberLike>[]>`
    SELECT x.studentId, MAX(u.\`name\`) AS name, MAX(st.\`nisn\`) AS nisn, MAX(k.\`name\`) AS className, MAX(x.schoolName) AS schoolName,
      SUM(x.cat = 'OVERDUE') AS overdueInvoices, SUM(IF(x.cat = 'OVERDUE', x.amount - x.paidAmount, 0)) AS outstanding,
      MIN(IF(x.cat = 'OVERDUE', x.dueDate, NULL)) AS oldestDueDate, SUM(x.cat = 'LATE') AS lateInvoices
    FROM ${source(scope, window, now)}
      JOIN \`Student\` st ON st.\`id\` = x.studentId
      JOIN \`User\` u ON u.\`id\` = st.\`userId\`
      LEFT JOIN \`SchoolClass\` k ON k.\`id\` = x.\`currentClassId\`
    GROUP BY x.studentId
    HAVING overdueInvoices > 0 OR lateInvoices > 0
    ORDER BY outstanding DESC, lateInvoices DESC, name ASC
    LIMIT 50`;
  return rows.map((row) => ({
    studentId: String(row.studentId), name: String(row.name), nisn: String(row.nisn), className: row.className ? String(row.className) : null,
    schoolName: String(row.schoolName), overdueInvoices: num(row.overdueInvoices), outstanding: num(row.outstanding),
    oldestDueDate: row.oldestDueDate instanceof Date ? row.oldestDueDate.toISOString().slice(0, 10) : null, lateInvoices: num(row.lateInvoices),
  }));
}
