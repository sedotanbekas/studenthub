import { prisma } from "@/lib/db";
import type { SchoolScope } from "@/lib/tenant/scope";
import { loadBillingSchool, schoolClock } from "./context";

/**
 * Statistik SPP untuk dashboard admin sekolah (dipakai domain dashboard). Hanya siswa ACTIVE, tagihan
 * UNPAID/PARTIAL dengan periode <= bulan ini ATAU jatuh tempo sudah lewat (tagihan dimuka yang belum jatuh
 * tempo tidak dihitung; yang sudah lewat = JATUH_TEMPO seperti di daftar tagihan); "hari ini" memakai zona
 * waktu sekolah. SUM MariaDB (Decimal/BigInt) dinormalisasi dengan Number().
 */
export interface BillingPeriodStats {
  readonly periodYear: number;
  readonly periodMonth: number;
  /** Tagihan tidak dibatalkan (paid + partial + unpaid). */
  readonly invoiced: number;
  readonly paid: number;
  readonly partial: number;
  readonly unpaid: number;
  readonly void: number;
  /** Σ nominal tagihan tidak dibatalkan. */
  readonly billedAmount: number;
  /** Σ terbayar. */
  readonly collectedAmount: number;
}

export interface BillingStats {
  /** Siswa ACTIVE dengan tagihan UNPAID/PARTIAL berperiode <= bulan ini atau sudah lewat jatuh tempo. */
  readonly studentsNotFullyPaid: number;
  /** Sebagian dari itu yang punya tagihan lewat jatuh tempo (dueDate < hari ini). */
  readonly studentsOverdue: number;
  /** Σ sisa tagihan baris yang sama. */
  readonly outstandingAmount: number;
  /** Bukti transfer menunggu verifikasi (semua siswa sekolah). */
  readonly pendingVerification: number;
  readonly period: BillingPeriodStats | null;
}

export interface BillingStatsFilter {
  readonly periodYear?: number;
  readonly periodMonth?: number;
}

/** COUNT -> bigint, SUM -> Decimal (driver); dinormalisasi dengan Number(). */
type NumberLike = unknown;

interface OutstandingRow {
  readonly notFully: NumberLike;
  readonly overdue: NumberLike;
  readonly outstanding: NumberLike;
}

const num = (value: NumberLike): number => (value === null || value === undefined ? 0 : Number(value));

async function outstandingTotals(schoolId: string, todayKey: number, today: string): Promise<OutstandingRow> {
  const rows = await prisma.$queryRaw<OutstandingRow[]>`
    SELECT COUNT(DISTINCT i.\`studentId\`) AS notFully,
           COUNT(DISTINCT CASE WHEN i.\`dueDate\` < ${today} THEN i.\`studentId\` END) AS overdue,
           COALESCE(SUM(i.\`amount\` - i.\`paidAmount\`), 0) AS outstanding
    FROM \`Invoice\` i JOIN \`Student\` s ON s.\`id\` = i.\`studentId\`
    WHERE i.\`schoolId\` = ${schoolId} AND i.\`status\` IN ('UNPAID', 'PARTIAL') AND s.\`status\` = 'ACTIVE'
      AND ((i.\`periodYear\` * 12 + i.\`periodMonth\` - 1) <= ${todayKey} OR i.\`dueDate\` < ${today})`;
  return rows[0] ?? { notFully: 0, overdue: 0, outstanding: 0 };
}

async function periodStats(schoolId: string, periodYear: number, periodMonth: number): Promise<BillingPeriodStats> {
  const groups = await prisma.invoice.groupBy({
    by: ["status"],
    where: { schoolId, periodYear, periodMonth },
    _count: { _all: true },
    _sum: { amount: true, paidAmount: true },
  });
  const of = (status: string) => groups.find((g) => g.status === status);
  const count = (status: string) => of(status)?._count._all ?? 0;
  const live = groups.filter((g) => g.status !== "VOID");
  return {
    periodYear,
    periodMonth,
    invoiced: live.reduce((sum, g) => sum + g._count._all, 0),
    paid: count("PAID"),
    partial: count("PARTIAL"),
    unpaid: count("UNPAID"),
    void: count("VOID"),
    billedAmount: live.reduce((sum, g) => sum + (g._sum.amount ?? 0), 0),
    collectedAmount: live.reduce((sum, g) => sum + (g._sum.paidAmount ?? 0), 0),
  };
}

/** billingStats(scope, {periodYear?, periodMonth?}, now): periode dihitung bila tahun DAN bulan diisi. */
export async function billingStats(scope: SchoolScope, filter: BillingStatsFilter, now: Date): Promise<BillingStats> {
  const school = await loadBillingSchool(prisma, scope.schoolId);
  const clock = schoolClock(school, now);
  const withPeriod = filter.periodYear !== undefined && filter.periodMonth !== undefined;
  const [totals, pendingVerification, period] = await Promise.all([
    outstandingTotals(scope.schoolId, clock.todayKey, clock.today),
    prisma.paymentSubmission.count({ where: { schoolId: scope.schoolId, status: "PENDING" } }),
    withPeriod ? periodStats(scope.schoolId, filter.periodYear as number, filter.periodMonth as number) : Promise.resolve(null),
  ]);
  return {
    studentsNotFullyPaid: num(totals.notFully),
    studentsOverdue: num(totals.overdue),
    outstandingAmount: num(totals.outstanding),
    pendingVerification,
    period,
  };
}
