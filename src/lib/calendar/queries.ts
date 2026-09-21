import { requireSchool } from "@/lib/academics/guards";
import { requirePrincipal, type ActionContext } from "@/lib/auth/principal";
import { prisma, type Tx } from "@/lib/db";
import { badRequest, notFound } from "@/lib/http/errors";
import { studentSelf, type SchoolScope } from "@/lib/tenant/scope";
import { fromDbDate, localParts, monthRange, toDbDate, wibDate, type LocalDate } from "@/lib/time/zone";
import { HOLIDAY_SELECT, toCalendarHoliday, toHolidayDto } from "./dto";
import { describeDays, holidayPeriod, monthKeyOf, type CalendarContext } from "./rules";
import type { HolidayDto, NationalHolidaysQuery, SchoolHolidaysQuery, StudentCalendarDto, StudentCalendarQuery } from "./schemas";

/** Query baca kalender: daftar libur, konteks kalender (dipakai absensi P2), kalender siswa. */
const MAX_HOLIDAYS = 500;
const MAX_TERMS = 50;

interface Period {
  readonly from: LocalDate;
  readonly to: LocalDate;
}

const overlapping = (period: Period) => ({ startDate: { lte: toDbDate(period.to) }, endDate: { gte: toDbDate(period.from) } });

export async function listSchoolHolidays(scope: SchoolScope, query: SchoolHolidaysQuery, ctx: ActionContext): Promise<HolidayDto[]> {
  const school = await requireSchool(prisma, scope);
  const period = holidayPeriod(query.year ?? localParts(ctx.now, school.timezone).year, query.month);
  const rows = await prisma.holiday.findMany({
    where: { OR: [{ schoolId: scope.schoolId }, { schoolId: null }], ...overlapping(period) },
    orderBy: [{ startDate: "asc" }, { name: "asc" }],
    select: HOLIDAY_SELECT,
    take: MAX_HOLIDAYS,
  });
  return rows.map(toHolidayDto);
}

export async function listNationalHolidays(query: NationalHolidaysQuery, ctx: ActionContext): Promise<HolidayDto[]> {
  const period = holidayPeriod(query.year ?? Number(wibDate(ctx.now).slice(0, 4)), query.month);
  const rows = await prisma.holiday.findMany({
    where: { schoolId: null, ...overlapping(period) },
    orderBy: [{ startDate: "asc" }, { name: "asc" }],
    select: HOLIDAY_SELECT,
    take: MAX_HOLIDAYS,
  });
  return rows.map(toHolidayDto);
}

/**
 * Konteks kalender satu sekolah untuk rentang tanggal: mask hari sekolah, libur sekolah + nasional,
 * dan semester yang beririsan. Masukan untuk checkSchoolDay/listSchoolDays (rules.ts).
 */
export async function loadCalendarContext(db: Tx, school: { id: string; schoolDaysMask: number }, period: Period): Promise<CalendarContext> {
  const [holidays, terms] = [
    await db.holiday.findMany({
      where: { OR: [{ schoolId: school.id }, { schoolId: null }], ...overlapping(period) },
      select: HOLIDAY_SELECT,
      take: MAX_HOLIDAYS,
    }),
    await db.term.findMany({ where: { schoolId: school.id, ...overlapping(period) }, select: { startDate: true, endDate: true }, take: MAX_TERMS }),
  ];
  return {
    schoolDaysMask: school.schoolDaysMask,
    holidays: holidays.map(toCalendarHoliday),
    terms: terms.map((t) => ({ startDate: fromDbDate(t.startDate), endDate: fromDbDate(t.endDate) })),
  };
}

/** Kalender bulanan siswa (ACTIVE/GRADUATED) untuk sekolahnya sendiri. */
export async function getStudentCalendar(query: StudentCalendarQuery, ctx: ActionContext): Promise<StudentCalendarDto> {
  const self = studentSelf(requirePrincipal(ctx));
  const school = await prisma.school.findUnique({ where: { id: self.schoolId }, select: { id: true, timezone: true, schoolDaysMask: true } });
  if (!school) throw notFound("Sekolah tidak ditemukan.");
  const month = query.month ?? monthKeyOf(localParts(ctx.now, school.timezone).ymd);
  const range = monthRange(month);
  if (!range) throw badRequest("VALIDATION_FAILED", "month harus berformat YYYY-MM.");
  const calendar = await loadCalendarContext(prisma, school, range);
  const days = describeDays(range.from, range.to, calendar);
  return { month, schoolDayCount: days.filter((day) => day.isSchoolDay).length, days };
}
