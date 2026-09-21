import type { LocalDate } from "@/lib/time/zone";
import { MONTH_NAMES } from "./constants";

/** Format teks Bahasa Indonesia untuk SPP (murni): rupiah, tanggal lokal, label periode. */

/** 1250000 -> "Rp 1.250.000" (tanpa Intl agar tidak bergantung data ICU). */
export function formatRupiah(amount: number): string {
  const digits = Math.trunc(Math.abs(amount)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${amount < 0 ? "-" : ""}Rp ${digits}`;
}

export const monthName = (month: number): string => MONTH_NAMES[month - 1] ?? String(month);

/** "2026-09-10" -> "10 September 2026". */
export function formatLocalDate(date: LocalDate): string {
  const [year = "", month = "1", day = "1"] = date.split("-");
  return `${Number(day)} ${monthName(Number(month))} ${year}`;
}

/** (2026, 9) -> "September 2026". */
export const periodLabel = (year: number, month: number): string => `${monthName(month)} ${year}`;
