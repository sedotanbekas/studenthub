import type { ActionContext } from "@/lib/auth/principal";
import { describeDays, listSchoolDays, type DayCheck } from "@/lib/calendar/rules";
import { loadCalendarContext } from "@/lib/calendar/queries";
import { prisma } from "@/lib/db";
import { badRequest } from "@/lib/http/errors";
import { fromDbDate, monthRange, toDbDate, type LocalDate } from "@/lib/time/zone";
import { closedThrough } from "./auto-alpha-rules";
import {
  aggregateByMonth,
  buildClassRates,
  buildDailyTrend,
  countsFrom,
  cutPeriod,
  deltaPp,
  monthOf,
  pct,
  presentOf,
  recentMonths,
  recordedOf,
  resolveRange,
  shiftMonth,
  summarize,
  type ClassStatusCount,
  type StatusCounts,
} from "./attendance-stats";
import { AUTO_ALPHA_JOB } from "./auto-alpha-rules";
import { timeLocal, toStudentBrief } from "./monitor-dto";
import type {
  ClassAnalyticsDto,
  ClassTrendDto,
  ClassTrendQuery,
  MonthScopeQuery,
  StudentMonthDto,
  StudentTrendDto,
  StudentTrendQuery,
  SummaryAnalyticsDto,
} from "./monitor-schemas";
import {
  assertClassInSchool,
  classNames,
  findStudentInSchool,
  loadMonitorSchool,
  monitorScope,
  schoolToday,
  type MonitorSchool,
} from "./monitoring-queries";

/**
 * Analitik absensi admin (desain 02 §3.10): persentase per kelas per bulan, ringkasan bulan + selisih
 * bulan lalu, tren harian kelas, tren bulanan siswa, dan tampilan bulan satu siswa. Semua agregasi
 * hanya atas hari yang sudah ditutup (tanggal <= closedThrough) dan memakai groupBy ber-index
 * [schoolId, date, classId, status]; kelas = snapshot classId saat baris dicatat.
 */
export const DEFAULT_TREND_RANGE_DAYS = 30;
/** Satu bulan paling banyak 31 baris per siswa; 12 bulan tren siswa <= 372 baris. */
const MAX_MONTH_ROWS = 31;
const MAX_TREND_ROWS = 400;

type Period = { readonly from: LocalDate; readonly to: LocalDate };

interface MonthWindow {
  readonly month: string;
  readonly range: Period;
  readonly closed: LocalDate;
  /** Bagian bulan yang sudah ditutup; null bila belum ada. */
  readonly cut: Period | null;
}

function monthWindow(school: MonitorSchool, month: string, now: Date): MonthWindow {
  const range = monthRange(month);
  if (!range) throw new RangeError(`Bulan tidak valid: ${month}`);
  const closed = closedThrough(now, school.timezone, school.dayEndMinute);
  return { month, range, closed, cut: cutPeriod(range.from, range.to, closed) };
}

const currentMonth = (school: MonitorSchool, now: Date): string => monthOf(schoolToday(school, now));

const dateFilter = (period: Period) => ({ gte: toDbDate(period.from), lte: toDbDate(period.to) });

async function classStatusGroups(schoolId: string, cut: Period | null): Promise<ClassStatusCount[]> {
  if (!cut) return [];
  const groups = await prisma.attendance.groupBy({ by: ["classId", "status"], where: { schoolId, date: dateFilter(cut) }, _count: { _all: true } });
  return groups.map((g) => ({ classId: g.classId, status: g.status, count: g._count._all }));
}

async function schoolCounts(schoolId: string, cut: Period | null): Promise<StatusCounts> {
  if (!cut) return countsFrom([]);
  const groups = await prisma.attendance.groupBy({ by: ["status"], where: { schoolId, date: dateFilter(cut) }, _count: { _all: true } });
  return countsFrom(groups.map((g) => ({ status: g.status, count: g._count._all })));
}

/** Hari sekolah tertutup di periode tanpa JobRun auto-alpha SUCCEEDED (data bisa belum lengkap). */
async function unclosedDates(school: MonitorSchool, cut: Period | null): Promise<LocalDate[]> {
  if (!cut) return [];
  const days = listSchoolDays(cut.from, cut.to, await loadCalendarContext(prisma, school, cut));
  if (days.length === 0) return [];
  const done = await prisma.jobRun.findMany({
    where: { job: AUTO_ALPHA_JOB, scopeKey: school.id, runKey: { in: days }, status: "SUCCEEDED" },
    select: { runKey: true },
    take: days.length,
  });
  const doneKeys = new Set(done.map((run) => run.runKey));
  return days.filter((day) => !doneKeys.has(day));
}

/** Grafik batang per kelas satu bulan + rata-rata sekolah (digabung, berbobot student-day). */
export async function getClassAnalytics(
  ctx: ActionContext,
  query: MonthScopeQuery,
): Promise<{ data: ClassAnalyticsDto; meta: { isPartial: boolean; unclosedDates: LocalDate[] } }> {
  const school = await loadMonitorSchool(monitorScope(ctx, query.schoolId));
  const window = monthWindow(school, query.month ?? currentMonth(school, ctx.now), ctx.now);
  const [groups, unclosed] = await Promise.all([classStatusGroups(school.id, window.cut), unclosedDates(school, window.cut)]);
  const names = await classNames(school.id, groups.map((g) => g.classId));
  const isPartial = window.range.to > window.closed;
  const data: ClassAnalyticsDto = {
    period: { month: window.month, ...window.range, closedThrough: window.closed, isPartial, unclosedDates: unclosed },
    school: summarize(countsFrom(groups)),
    classes: buildClassRates(groups, names),
  };
  return { data, meta: { isPartial, unclosedDates: unclosed } };
}

/** Donat bulan ini + selisih poin persen terhadap bulan lalu. */
export async function getSummaryAnalytics(ctx: ActionContext, query: MonthScopeQuery): Promise<SummaryAnalyticsDto> {
  const school = await loadMonitorSchool(monitorScope(ctx, query.schoolId));
  const window = monthWindow(school, query.month ?? currentMonth(school, ctx.now), ctx.now);
  const prev = monthWindow(school, shiftMonth(window.month, -1), ctx.now);
  const [current, previous] = await Promise.all([schoolCounts(school.id, window.cut), schoolCounts(school.id, prev.cut)]);
  const rates = summarize(current);
  const prevPresentPct = summarize(previous).presentPct;
  return {
    ...rates,
    month: window.month,
    closedThrough: window.closed,
    isPartial: window.range.to > window.closed,
    prevMonth: prev.month,
    prevPresentPct,
    deltaPp: deltaPp(rates.presentPct, prevPresentPct),
  };
}

/** Tren harian satu kelas (kelas snapshot) dalam rentang <= 92 hari, dipotong di closedThrough. */
export async function getClassTrend(ctx: ActionContext, classId: string, query: ClassTrendQuery): Promise<ClassTrendDto> {
  const scope = monitorScope(ctx, query.schoolId);
  const school = await loadMonitorSchool(scope);
  const klass = await assertClassInSchool(scope, classId);
  const range = resolveRange(query.from, query.to, schoolToday(school, ctx.now), DEFAULT_TREND_RANGE_DAYS);
  if (!range) throw badRequest("VALIDATION_FAILED", "Rentang tanggal tidak valid (from <= to, maksimal 92 hari).");
  const closed = closedThrough(ctx.now, school.timezone, school.dayEndMinute);
  const cut = cutPeriod(range.from, range.to, closed);
  const [groups, calendar] = cut
    ? await Promise.all([
        prisma.attendance.groupBy({ by: ["date", "status"], where: { schoolId: school.id, classId, date: dateFilter(cut) }, _count: { _all: true } }),
        loadCalendarContext(prisma, school, cut),
      ])
    : [[], null];
  const days = buildDailyTrend(
    groups.map((g) => ({ date: fromDbDate(g.date), status: g.status, count: g._count._all })),
    cut && calendar ? listSchoolDays(cut.from, cut.to, calendar) : [],
  );
  return { classId: klass.id, className: klass.name, from: range.from, to: range.to, closedThrough: closed, days };
}

/** Tren bulanan satu siswa (n bulan terakhir termasuk bulan berjalan). */
export async function getStudentTrend(ctx: ActionContext, studentId: string, query: StudentTrendQuery): Promise<StudentTrendDto> {
  const scope = monitorScope(ctx, query.schoolId);
  const school = await loadMonitorSchool(scope);
  const student = await findStudentInSchool(scope, studentId);
  const closed = closedThrough(ctx.now, school.timezone, school.dayEndMinute);
  const months = recentMonths(currentMonth(school, ctx.now), query.months);
  const first = monthRange(months[0] ?? "")?.from ?? closed;
  const rows =
    closed < first
      ? []
      : await prisma.attendance.findMany({
          where: { schoolId: school.id, studentId, date: dateFilter({ from: first, to: closed }) },
          orderBy: { date: "asc" },
          take: MAX_TREND_ROWS,
          select: { date: true, status: true },
        });
  const buckets = aggregateByMonth(rows.map((row) => ({ date: fromDbDate(row.date), status: row.status })), months);
  return { student: toStudentBrief(student), closedThrough: closed, months: buckets.map((b) => ({ month: b.month, ...summarize(b.counts) })) };
}

type NonSchoolReason = StudentMonthDto["nonSchoolDays"][number]["reason"];
const isNonSchool = (day: DayCheck): day is DayCheck & { reason: NonSchoolReason } => day.reason !== "SCHOOL_DAY";

function monthSummary(rows: ReadonlyArray<{ date: LocalDate; status: StudentMonthDto["days"][number]["status"] }>, closed: LocalDate): StudentMonthDto["summary"] {
  const counts = countsFrom(rows.filter((row) => row.date <= closed).map((row) => ({ status: row.status, count: 1 })));
  const recorded = recordedOf(counts);
  const present = presentOf(counts);
  return { recorded, present, late: counts.terlambat, izin: counts.izin, sakit: counts.sakit, alpha: counts.alpha, presentPct: pct(present, recorded) };
}

/** Tampilan bulan satu siswa untuk admin (bentuk sama dengan riwayat bulanan siswa + identitas siswa). */
export async function getStudentMonth(
  ctx: ActionContext,
  studentId: string,
  query: MonthScopeQuery,
): Promise<{ data: StudentMonthDto; meta: { prevMonth: string; nextMonth: string } }> {
  const scope = monitorScope(ctx, query.schoolId);
  const school = await loadMonitorSchool(scope);
  const student = await findStudentInSchool(scope, studentId);
  const window = monthWindow(school, query.month ?? currentMonth(school, ctx.now), ctx.now);
  const [rows, calendar] = await Promise.all([
    prisma.attendance.findMany({
      where: { schoolId: school.id, studentId, date: dateFilter(window.range) },
      orderBy: { date: "asc" },
      take: MAX_MONTH_ROWS,
      select: { id: true, date: true, status: true, source: true, checkInAt: true, lateMinutes: true, leaveRequestId: true },
    }),
    loadCalendarContext(prisma, school, window.range),
  ]);
  const days = rows.map((row) => ({
    id: row.id,
    date: fromDbDate(row.date),
    status: row.status,
    source: row.source,
    checkInTimeLocal: timeLocal(row.checkInAt, school.timezone),
    lateMinutes: row.lateMinutes,
    leaveRequestId: row.leaveRequestId,
  }));
  const nonSchoolDays = describeDays(window.range.from, window.range.to, calendar)
    .filter(isNonSchool)
    .map((day) => ({ date: day.date, reason: day.reason, name: day.holidayName }));
  const data: StudentMonthDto = {
    month: window.month,
    student: toStudentBrief(student),
    closedThrough: window.closed,
    days,
    nonSchoolDays,
    summary: monthSummary(days, window.closed),
  };
  return { data, meta: { prevMonth: shiftMonth(window.month, -1), nextMonth: shiftMonth(window.month, 1) } };
}
