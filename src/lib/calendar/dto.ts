import { fromDbDate } from "@/lib/time/zone";
import { inclusiveDays } from "./ranges";
import type { CalendarHoliday } from "./rules";
import type { HolidayDto } from "./schemas";

export interface HolidayRow {
  readonly id: string;
  readonly schoolId: string | null;
  readonly name: string;
  readonly startDate: Date;
  readonly endDate: Date;
}

export const HOLIDAY_SELECT = { id: true, schoolId: true, name: true, startDate: true, endDate: true } as const;

export function toHolidayDto(row: HolidayRow): HolidayDto {
  const range = { startDate: fromDbDate(row.startDate), endDate: fromDbDate(row.endDate) };
  return { id: row.id, name: row.name, ...range, dayCount: inclusiveDays(range), scope: row.schoolId ? "SCHOOL" : "NATIONAL" };
}

export const toCalendarHoliday = (row: HolidayRow): CalendarHoliday => ({
  name: row.name,
  startDate: fromDbDate(row.startDate),
  endDate: fromDbDate(row.endDate),
});
