/**
 * Rencana murni tagihan SPP demo (tanpa I/O, diuji unit): periode Juli–September 2026, pola status per
 * siswa, tanggal terbit & jatuh tempo, serta jadwal pembayaran tunai. Penulisan ada di demo-billing.ts.
 */
import { defaultDueDate } from "../../src/lib/billing/period-rules";
import { addDays, type LocalDate } from "../../src/lib/time/zone";
import { DEMO_ACADEMIC_YEAR } from "./demo-data";

export interface DemoPeriod {
  readonly periodYear: number;
  readonly periodMonth: number;
}

export const DEMO_BILLING_PERIODS: readonly DemoPeriod[] = [
  { periodYear: 2026, periodMonth: 7 },
  { periodYear: 2026, periodMonth: 8 },
  { periodYear: 2026, periodMonth: 9 },
];
export const DEMO_CASH_NOTE = "Setoran tunai di TU (data demo)";
export const DEMO_TRANSFER_NOTE = "Transfer SPP (data demo)";
/** Menit lokal tagihan diterbitkan (08.00). */
export const DEMO_ISSUE_MINUTE = 8 * 60;
const CASH_FIRST_MINUTE = 8 * 60;
const CASH_MINUTE_SPREAD = 7 * 60;
/** Jatuh tempo minimal sekian hari setelah tagihan terbit (Juli terbit di awal tahun ajaran). */
const MIN_DUE_AFTER_ISSUE_DAYS = 10;

export type DemoInvoiceOutcome = "PAID" | "PARTIAL" | "UNPAID" | "PENDING_TRANSFER";

/** Pola deterministik per siswa (urutan spesifikasi) & periode (0 = Juli): Juli hampir lunas, September banyak menunggak. */
export function demoInvoiceOutcome(studentIndex: number, periodIndex: number): DemoInvoiceOutcome {
  if (periodIndex === 0) return studentIndex % 5 === 4 ? "PARTIAL" : "PAID";
  if (periodIndex === 1) return (["PAID", "PARTIAL", "UNPAID"] as const)[studentIndex % 3] ?? "UNPAID";
  if (studentIndex === 0) return "PENDING_TRANSFER";
  return studentIndex % 4 === 1 ? "PAID" : "UNPAID";
}

const monthStart = (period: DemoPeriod): LocalDate => `${period.periodYear}-${String(period.periodMonth).padStart(2, "0")}-01`;

/** Tanggal terbit: tanggal 1, tetapi tidak sebelum awal tahun ajaran demo (siswa baru aktif 13 Juli). */
export function demoIssueDate(period: DemoPeriod): LocalDate {
  const first = monthStart(period);
  return first < DEMO_ACADEMIC_YEAR.startDate ? DEMO_ACADEMIC_YEAR.startDate : first;
}

/** Jatuh tempo default (tanggal 10) kecuali tagihan terbit sesudahnya -> terbit + 10 hari. */
export function demoDueDate(period: DemoPeriod): LocalDate {
  const fallback = defaultDueDate(period.periodYear, period.periodMonth);
  const issued = demoIssueDate(period);
  return fallback > issued ? fallback : addDays(issued, MIN_DUE_AFTER_ISSUE_DAYS);
}

export interface DemoCashPlan {
  readonly amount: number;
  readonly date: LocalDate;
  readonly minuteOfDay: number;
}

/** Tunai: LUNAS = penuh (1–7 hari setelah terbit), SEBAGIAN = setengah dibulatkan ribuan (9–13 hari setelah terbit). */
export function demoCashPlan(outcome: DemoInvoiceOutcome, amount: number, period: DemoPeriod, studentIndex: number): DemoCashPlan | null {
  const issued = demoIssueDate(period);
  const minuteOfDay = CASH_FIRST_MINUTE + ((studentIndex * 17) % CASH_MINUTE_SPREAD);
  if (outcome === "PAID") return { amount, date: addDays(issued, 1 + (studentIndex % 7)), minuteOfDay };
  if (outcome === "PARTIAL") return { amount: Math.floor(amount / 2000) * 1000, date: addDays(issued, 9 + (studentIndex % 5)), minuteOfDay };
  return null;
}
