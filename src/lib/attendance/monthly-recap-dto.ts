import { periodLabel } from "@/lib/billing/format";
import type { LocalDate } from "@/lib/time/zone";
import { toTallyDto, type ClassRecap, type MonthlyRecapDay } from "./monthly-recap-rules";
import type { MonthlyRecapDto } from "./monthly-recap-schemas";

/** DTO rekap bulanan (murni): dipakai server DAN demo agar bentuk & angka tidak bisa berbeda. */

export interface RecapDtoInput {
  readonly month: string;
  readonly range: { readonly from: LocalDate; readonly to: LocalDate };
  readonly closed: LocalDate;
  readonly days: readonly MonthlyRecapDay[];
  readonly unclosed: readonly LocalDate[];
  readonly klass: { readonly id: string; readonly name: string };
  readonly recap: ClassRecap;
  readonly classLabel: (id: string | null) => string;
}

/** "2026-09" -> "September 2026". */
export function monthLabelOf(month: string): string {
  const [year, value] = month.split("-").map(Number) as [number, number];
  return periodLabel(year, value);
}

/** Final = seluruh bulan sudah lewat jam tutup dan tidak ada hari yang belum ditutup. */
export const isFinalMonth = (input: Pick<RecapDtoInput, "range" | "closed" | "unclosed">): boolean => input.range.to <= input.closed && input.unclosed.length === 0;

export function toMonthlyRecapDto(input: RecapDtoInput): MonthlyRecapDto {
  return {
    month: input.month,
    monthLabel: monthLabelOf(input.month),
    class: { id: input.klass.id, name: input.klass.name },
    closedThrough: input.closed,
    isFinal: isFinalMonth(input),
    unclosedDates: [...input.unclosed],
    days: input.days.map((d) => ({ ...d })),
    students: input.recap.students.map((s) => ({
      studentId: s.studentId,
      name: s.name,
      nis: s.nis,
      studentStatus: s.studentStatus,
      cells: [...s.cells],
      otherClasses: s.otherClassIds.map((id) => ({ id, name: input.classLabel(id) })),
      totals: toTallyDto(s.totals),
    })),
    totals: toTallyDto(input.recap.totals),
  };
}
