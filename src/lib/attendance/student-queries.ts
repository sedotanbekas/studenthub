import type { SchoolTimezone } from "@prisma/client";
import { termLabel } from "@/lib/academics/rules";
import type { ActionContext } from "@/lib/auth/principal";
import { loadCalendarContext } from "@/lib/calendar/queries";
import { describeDays } from "@/lib/calendar/rules";
import { prisma } from "@/lib/db";
import { badRequest, notFound, unprocessable } from "@/lib/http/errors";
import { formatMinute, fromDbDate, localParts, monthRange, toDbDate, TZ_IANA, type LocalDate } from "@/lib/time/zone";
import { todayBlockReason, windowState } from "./check-in-rules";
import { loadCheckInContext, loadStudentSchool, type CheckInContext, type CheckInStudent } from "./check-in-context";
import { closedThrough } from "./auto-alpha-rules";
import { HISTORY_MAX_MONTHS_BACK, MAX_ACCEPTED_ACCURACY_M } from "./constants";
import {
  ATTENDANCE_ROW_SELECT,
  countsFromGroups,
  countStatuses,
  isHistoryMonthAllowed,
  minDate,
  monthNavigation,
  monthSummary,
  termCounts,
  toHistoryDay,
  toTodayRecord,
  type StatusCounts,
} from "./student-dto";
import type { HistoryDto, HistoryQuery, SummaryDto, SummaryQuery, TodayDto } from "./student-schemas";

/** Query baca absensi milik siswa sendiri: layar hari ini, riwayat bulanan, ringkasan semester. */
const MAX_DAYS_IN_MONTH = 31;

async function pendingLeaveCovering(student: CheckInStudent, date: LocalDate): Promise<TodayDto["pendingLeave"]> {
  const day = toDbDate(date);
  const row = await prisma.leaveRequest.findFirst({
    where: { studentId: student.id, schoolId: student.schoolId, status: "PENDING", startDate: { lte: day }, endDate: { gte: day } },
    orderBy: { createdAt: "desc" },
    select: { id: true, type: true, startDate: true, endDate: true },
  });
  return row ? { id: row.id, type: row.type, startDate: fromDbDate(row.startDate), endDate: fromDbDate(row.endDate) } : null;
}

function todayWindow(context: CheckInContext): TodayDto["window"] {
  const { schedule } = context.school;
  return {
    opensAt: formatMinute(schedule.openMinute),
    lateAfter: formatMinute(schedule.startMinute + schedule.lateToleranceMinutes),
    closesAt: formatMinute(schedule.closeMinute),
    state: windowState(context.local.minuteOfDay, schedule),
  };
}

export async function getTodayAttendance(ctx: ActionContext): Promise<TodayDto> {
  const context = await loadCheckInContext(ctx);
  const { school, local, day, existing } = context;
  const window = todayWindow(context);
  const blockReason = todayBlockReason({ existingSource: existing?.source ?? null, day, window: window.state });
  return {
    date: local.ymd,
    serverTime: ctx.now.toISOString(),
    timezone: school.timezone,
    ianaTimezone: TZ_IANA[school.timezone],
    schoolDay: { isSchoolDay: day.isSchoolDay, reason: day.reason, holidayName: day.holidayName },
    window,
    geofence: { radiusM: school.geofence.radiusM, maxAccuracyM: MAX_ACCEPTED_ACCURACY_M },
    record: toTodayRecord(existing, school.timezone),
    pendingLeave: await pendingLeaveCovering(context.student, local.ymd),
    canCheckIn: blockReason === null,
    blockReason,
  };
}

function nonSchoolDaysOf(days: ReturnType<typeof describeDays>): HistoryDto["nonSchoolDays"] {
  return days.filter((day) => !day.isSchoolDay).map((day) => ({ date: day.date, reason: day.reason, name: day.holidayName }));
}

function resolveMonth(requested: string | undefined, currentMonth: string): { month: string; from: LocalDate; to: LocalDate } {
  const month = requested ?? currentMonth;
  if (!isHistoryMonthAllowed(month, currentMonth)) {
    throw unprocessable("MONTH_OUT_OF_RANGE", `Riwayat hanya tersedia untuk bulan berjalan sampai ${HISTORY_MAX_MONTHS_BACK} bulan sebelumnya.`, {
      month,
      currentMonth,
      maxMonthsBack: HISTORY_MAX_MONTHS_BACK,
    });
  }
  const range = monthRange(month);
  if (!range) throw badRequest("VALIDATION_FAILED", "month harus berformat YYYY-MM.");
  return { month, ...range };
}

export interface HistoryResult {
  readonly data: HistoryDto;
  readonly meta: { prevMonth: string | null; nextMonth: string | null };
}

export async function getAttendanceMonth(query: HistoryQuery, ctx: ActionContext): Promise<HistoryResult> {
  const { student, school } = await loadStudentSchool(ctx);
  const tz = school.timezone;
  const currentMonth = localParts(ctx.now, tz).ymd.slice(0, 7);
  const { month, from, to } = resolveMonth(query.month, currentMonth);
  const [rows, calendar] = await Promise.all([
    prisma.attendance.findMany({
      where: { studentId: student.id, schoolId: student.schoolId, date: { gte: toDbDate(from), lte: toDbDate(to) } },
      orderBy: { date: "asc" },
      select: ATTENDANCE_ROW_SELECT,
      take: MAX_DAYS_IN_MONTH,
    }),
    loadCalendarContext(prisma, { id: school.id, schoolDaysMask: school.schoolDaysMask }, { from, to }),
  ]);
  const cut = minDate(to, closedThrough(ctx.now, tz, school.dayEndMinute));
  const counted = rows.filter((row) => fromDbDate(row.date) <= cut).map((row) => row.status);
  return {
    data: {
      month,
      days: rows.map((row) => toHistoryDay(row, tz)),
      nonSchoolDays: nonSchoolDaysOf(describeDays(from, to, calendar)),
      summary: monthSummary(countStatuses(counted)),
    },
    meta: monthNavigation(month, currentMonth),
  };
}

const TERM_SELECT = { id: true, semester: true, startDate: true, endDate: true, academicYear: { select: { name: true } } } as const;

/** termId diberikan -> semester sekolah ini (lain sekolah 404); selain itu yang mencakup hari ini / terakhir dimulai / terdekat. */
async function resolveTerm(schoolId: string, termId: string | undefined, today: LocalDate) {
  if (termId !== undefined) {
    const term = await prisma.term.findFirst({ where: { id: termId, schoolId }, select: TERM_SELECT });
    if (!term) throw notFound("Semester tidak ditemukan.");
    return term;
  }
  const started = await prisma.term.findFirst({ where: { schoolId, startDate: { lte: toDbDate(today) } }, orderBy: { startDate: "desc" }, select: TERM_SELECT });
  const term = started ?? (await prisma.term.findFirst({ where: { schoolId }, orderBy: { startDate: "asc" }, select: TERM_SELECT }));
  if (!term) throw notFound("Sekolah belum memiliki semester.");
  return term;
}

async function countStatusesBetween(student: CheckInStudent, from: LocalDate, to: LocalDate): Promise<StatusCounts> {
  if (to < from) return countStatuses([]);
  const groups = await prisma.attendance.groupBy({
    by: ["status"],
    where: { studentId: student.id, schoolId: student.schoolId, date: { gte: toDbDate(from), lte: toDbDate(to) } },
    _count: { _all: true },
  });
  return countsFromGroups(groups.map((g) => ({ status: g.status, count: g._count._all })));
}

export async function getAttendanceSummary(query: SummaryQuery, ctx: ActionContext): Promise<SummaryDto> {
  const { student, school } = await loadStudentSchool(ctx);
  const tz: SchoolTimezone = school.timezone;
  const term = await resolveTerm(school.id, query.termId, localParts(ctx.now, tz).ymd);
  const startDate = fromDbDate(term.startDate);
  const endDate = fromDbDate(term.endDate);
  const cut = minDate(endDate, closedThrough(ctx.now, tz, school.dayEndMinute));
  const counts = await countStatusesBetween(student, startDate, cut);
  return {
    term: { id: term.id, label: termLabel(term.semester, term.academicYear.name), startDate, endDate },
    ...termCounts(counts),
    closedThrough: cut >= startDate ? cut : null,
  };
}
