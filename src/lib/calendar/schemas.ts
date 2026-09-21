import { z } from "zod";
import { EMPTY_PATCH_MESSAGE, dateOutSchema, hasAnyField, localDateSchema, schoolIdQuery } from "@/lib/academics/schema-common";
import { DAY_REASONS } from "./rules";

// ----------------------------------------------------------------------------- respons

export const holidaySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    startDate: dateOutSchema,
    endDate: dateOutSchema,
    dayCount: z.int(),
    scope: z.enum(["SCHOOL", "NATIONAL"]).meta({ description: "SCHOOL = libur sekolah; NATIONAL = libur nasional/cuti bersama." }),
  })
  .meta({ id: "CalendarHoliday" });

export const calendarDaySchema = z
  .object({
    date: dateOutSchema,
    isSchoolDay: z.boolean(),
    reason: z.enum(DAY_REASONS).meta({ description: "Prioritas: HOLIDAY > OUTSIDE_TERM > DAY_OFF." }),
    holidayName: z.string().nullable(),
  })
  .meta({ id: "CalendarDay" });

export const studentCalendarSchema = z
  .object({ month: z.string().meta({ example: "2026-09" }), schoolDayCount: z.int(), days: z.array(calendarDaySchema) })
  .meta({ id: "StudentCalendarMonth" });

export type HolidayDto = z.infer<typeof holidaySchema>;
export type StudentCalendarDto = z.infer<typeof studentCalendarSchema>;

// ----------------------------------------------------------------------------- input

const periodShape = {
  year: z.coerce.number().int().min(2000).max(2100).optional().meta({ description: "Default: tahun berjalan (waktu lokal)." }),
  month: z.coerce.number().int().min(1).max(12).optional().meta({ description: "Opsional: batasi ke satu bulan." }),
};

export const schoolHolidaysQuery = schoolIdQuery.extend(periodShape);
export const nationalHolidaysQuery = z.object(periodShape);

const holidayName = z.string().trim().min(3, "Nama libur minimal 3 karakter.").max(150, "Nama libur maksimal 150 karakter.");

/** Tanpa schoolId: sekolah SELALU dari cakupan (kunci asing di body -> 400). */
export const createHolidayBody = z.strictObject({ name: holidayName, startDate: localDateSchema, endDate: localDateSchema });

export const updateHolidayBody = z
  .strictObject({ name: holidayName.optional(), startDate: localDateSchema.optional(), endDate: localDateSchema.optional() })
  .refine(hasAnyField, EMPTY_PATCH_MESSAGE);

export const studentCalendarQuery = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month harus berformat YYYY-MM.")
    .optional()
    .meta({ description: "Default: bulan berjalan (waktu lokal sekolah).", example: "2026-09" }),
});

export type SchoolHolidaysQuery = z.output<typeof schoolHolidaysQuery>;
export type NationalHolidaysQuery = z.output<typeof nationalHolidaysQuery>;
export type CreateHolidayInput = z.output<typeof createHolidayBody>;
export type UpdateHolidayInput = z.output<typeof updateHolidayBody>;
export type StudentCalendarQuery = z.output<typeof studentCalendarQuery>;
