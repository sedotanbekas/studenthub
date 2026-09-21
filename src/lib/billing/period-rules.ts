import type { StudentStatus } from "@prisma/client";
import { daysInMonth, type LocalDate } from "@/lib/time/zone";
import {
  DEFAULT_DUE_DAY,
  DUE_DATE_MAX_OFFSET_MONTHS,
  DUE_DATE_MIN_OFFSET_MONTHS,
  MAX_FUTURE_PERIOD_MONTHS,
  MAX_PAST_PERIOD_MONTHS,
} from "./constants";
import { violation, type BillingViolation } from "./errors";
import { formatLocalDate, periodLabel } from "./format";

/**
 * Aturan periode tagihan & jatuh tempo (murni). Periode = (tahun, bulan 1-12); periodKey = tahun*12 + bulan-1
 * sehingga perbandingan antarbulan cukup aritmetika bilangan bulat.
 */
export interface Period {
  readonly year: number;
  readonly month: number;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

export const periodKey = (year: number, month: number): number => year * 12 + (month - 1);

/** periodKey bulan dari tanggal lokal "YYYY-MM-DD". */
export function periodKeyOfDate(date: LocalDate): number {
  const [year = "0", month = "1"] = date.split("-");
  return periodKey(Number(year), Number(month));
}

export function shiftPeriod(year: number, month: number, deltaMonths: number): Period {
  const key = periodKey(year, month) + deltaMonths;
  return { year: Math.floor(key / 12), month: (key % 12) + 1 };
}

export function validatePeriod(year: number, month: number, today: LocalDate): BillingViolation | null {
  const offset = periodKey(year, month) - periodKeyOfDate(today);
  if (offset >= -MAX_PAST_PERIOD_MONTHS && offset <= MAX_FUTURE_PERIOD_MONTHS) return null;
  return violation(
    "PERIOD_OUT_OF_RANGE",
    `Periode tagihan harus antara ${MAX_PAST_PERIOD_MONTHS} bulan lalu dan ${MAX_FUTURE_PERIOD_MONTHS} bulan ke depan.`,
    { maxPastMonths: MAX_PAST_PERIOD_MONTHS, maxFutureMonths: MAX_FUTURE_PERIOD_MONTHS },
  );
}

export const invoiceTitle = (year: number, month: number): string => `SPP ${periodLabel(year, month)}`;

/** Tanggal DEFAULT_DUE_DAY bulan periode, dipotong ke panjang bulan. */
export function defaultDueDate(year: number, month: number): LocalDate {
  return `${year}-${pad2(month)}-${pad2(Math.min(DEFAULT_DUE_DAY, daysInMonth(year, month)))}`;
}

/** Jendela jatuh tempo: hari pertama (periode - 1 bulan) .. hari terakhir (periode + 3 bulan), inklusif. */
export function dueDateWindow(year: number, month: number): { from: LocalDate; to: LocalDate } {
  const first = shiftPeriod(year, month, DUE_DATE_MIN_OFFSET_MONTHS);
  const last = shiftPeriod(year, month, DUE_DATE_MAX_OFFSET_MONTHS);
  return {
    from: `${first.year}-${pad2(first.month)}-01`,
    to: `${last.year}-${pad2(last.month)}-${pad2(daysInMonth(last.year, last.month))}`,
  };
}

export function validateDueDate(dueDate: LocalDate, year: number, month: number): BillingViolation | null {
  const window = dueDateWindow(year, month);
  if (dueDate >= window.from && dueDate <= window.to) return null;
  return violation(
    "DUE_DATE_OUT_OF_RANGE",
    `Jatuh tempo harus antara ${formatLocalDate(window.from)} dan ${formatLocalDate(window.to)}.`,
    { from: window.from, to: window.to },
  );
}

/**
 * Siswa yang boleh ditagih: ACTIVE selalu; INACTIVE/GRADUATED hanya tunggakan (periode <= bulan ini);
 * DRAFT & MOVED tidak pernah.
 */
export function billableViolation(status: StudentStatus, key: number, todayKey: number): BillingViolation | null {
  if (status === "ACTIVE") return null;
  if ((status === "INACTIVE" || status === "GRADUATED") && key <= todayKey) return null;
  return violation(
    "STUDENT_NOT_BILLABLE",
    status === "INACTIVE" || status === "GRADUATED"
      ? "Siswa nonaktif/lulus hanya dapat ditagih untuk periode yang sudah berjalan (tunggakan)."
      : "Siswa berstatus draf atau pindah tidak dapat ditagih.",
    { studentStatus: status },
  );
}
