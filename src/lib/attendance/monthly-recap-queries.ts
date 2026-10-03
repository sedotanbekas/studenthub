import type { Prisma } from "@prisma/client";
import type { ActionContext } from "@/lib/auth/principal";
import { loadCalendarContext } from "@/lib/calendar/queries";
import { describeDays } from "@/lib/calendar/rules";
import { prisma } from "@/lib/db";
import { badRequest, unprocessable } from "@/lib/http/errors";
import type { SchoolScope } from "@/lib/tenant/scope";
import { fromDbDate, monthRange, toDbDate, type LocalDate } from "@/lib/time/zone";
import { DELETED_CLASS_LABEL, NO_CLASS_LABEL, cutPeriod, monthOf } from "./attendance-stats";
import { closedThrough } from "./auto-alpha-rules";
import { listUnclosedDates } from "./closure-queries";
import {
  MAX_EXPORT_ROWS,
  MAX_EXPORT_STUDENTS,
  MAX_RECAP_STUDENTS,
  buildClassRecap,
  buildRecapDays,
  type MonthlyRecapCandidate,
  type MonthlyRecapDay,
  type MonthlyRecapRow,
} from "./monthly-recap-rules";
import { toMonthlyRecapDto } from "./monthly-recap-dto";
import type { MonthlyRecapDto, MonthlyRecapQuery } from "./monthly-recap-schemas";
import { assertClassInSchool, eligibleOn, loadMonitorSchool, monitorScope, schoolToday, type MonitorSchool } from "./monitoring-queries";

/**
 * Query rekap bulanan per kelas (A3, desain 02 §3.13). Baca saja (tanpa transaksi/kunci), selalu ber-schoolId &
 * ber-take. Layar dan Excel memakai pemuat & builder yang sama sehingga angkanya tidak bisa berbeda. Tidak pernah
 * memilih NISN, selfie, koordinat, atau catatan.
 */

export interface RecapCaps {
  readonly students: number;
  readonly rows: number;
}

export const SCREEN_CAPS: RecapCaps = { students: MAX_RECAP_STUDENTS, rows: MAX_RECAP_STUDENTS * 31 };
export const EXPORT_CAPS: RecapCaps = { students: MAX_EXPORT_STUDENTS, rows: MAX_EXPORT_ROWS };

type Period = { readonly from: LocalDate; readonly to: LocalDate };

export interface RecapBase {
  readonly scope: SchoolScope;
  readonly school: MonitorSchool;
  readonly month: string;
  readonly range: Period;
  readonly closed: LocalDate;
  readonly days: MonthlyRecapDay[];
  readonly unclosed: LocalDate[];
}

export interface RecapSource {
  readonly candidates: MonthlyRecapCandidate[];
  readonly rows: MonthlyRecapRow[];
}

const ROW_SELECT = {
  studentId: true,
  date: true,
  classId: true,
  status: true,
  source: true,
  lateMinutes: true,
  lateReasonCategory: true,
} as const satisfies Prisma.AttendanceSelect;

const STUDENT_SELECT = { id: true, nis: true, status: true, currentClassId: true, user: { select: { name: true } } } as const satisfies Prisma.StudentSelect;

export const CLASS_TOO_LARGE = "Kelas ini terlalu besar untuk ditampilkan; unduh Excel per kelas.";
export const EXPORT_TOO_LARGE = "Data bulan ini terlalu besar untuk satu berkas — unduh per kelas.";

const dateFilter = (period: Period) => ({ gte: toDbDate(period.from), lte: toDbDate(period.to) });

/** Sekolah, rentang bulan, hari (status kalender + penutupan). Bulan default = bulan berjalan lokal sekolah. */
export async function loadRecapBase(ctx: ActionContext, schoolId: string | undefined, month: string | undefined): Promise<RecapBase> {
  const scope = monitorScope(ctx, schoolId);
  const school = await loadMonitorSchool(scope);
  const wanted = month ?? monthOf(schoolToday(school, ctx.now));
  const range = monthRange(wanted);
  if (!range) throw badRequest("VALIDATION_FAILED", "month harus berformat YYYY-MM.");
  const closed = closedThrough(ctx.now, school.timezone, school.dayEndMinute);
  const [calendar, unclosed] = await Promise.all([
    loadCalendarContext(prisma, school, range),
    listUnclosedDates(prisma, school, cutPeriod(range.from, range.to, closed), ctx.now),
  ]);
  const days = buildRecapDays(describeDays(range.from, range.to, calendar), closed, unclosed);
  return { scope, school, month: wanted, range, closed, days, unclosed };
}

async function loadByIds(school: MonitorSchool, ids: readonly string[], eligible: ReadonlySet<string>, range: Period, caps: RecapCaps, tooLarge: string): Promise<RecapSource> {
  if (ids.length === 0) return { candidates: [], rows: [] };
  const [students, rows] = await Promise.all([
    prisma.student.findMany({ where: { schoolId: school.id, id: { in: [...ids] } }, select: STUDENT_SELECT, take: ids.length }),
    prisma.attendance.findMany({
      where: { schoolId: school.id, studentId: { in: [...ids] }, date: dateFilter(range) },
      select: ROW_SELECT,
      orderBy: [{ studentId: "asc" }, { date: "asc" }],
      take: caps.rows + 1,
    }),
  ]);
  if (rows.length > caps.rows) throw unprocessable("RECAP_TOO_LARGE", tooLarge);
  return {
    candidates: students.map((s) => ({ id: s.id, name: s.user.name, nis: s.nis, status: s.status, currentClassId: s.currentClassId, isCurrentEligible: eligible.has(s.id) })),
    rows: rows.map((r) => ({ studentId: r.studentId, date: fromDbDate(r.date), classId: r.classId, status: r.status, source: r.source, lateMinutes: r.lateMinutes, lateReason: r.lateReasonCategory })),
  };
}

/** Siswa satu kelas: yang punya baris di kelas ini + anggota layak saat ini; lalu SEMUA baris bulan itu milik mereka. */
export async function loadClassSource(school: MonitorSchool, classId: string, range: Period, caps: RecapCaps, tooLarge = CLASS_TOO_LARGE): Promise<RecapSource> {
  const [withRows, current] = await Promise.all([
    prisma.attendance.groupBy({ by: ["studentId"], where: { schoolId: school.id, classId, date: dateFilter(range) }, orderBy: { studentId: "asc" }, take: caps.students + 1 }),
    prisma.student.findMany({ where: { ...eligibleOn(school, range.to), currentClassId: classId }, select: { id: true }, orderBy: { id: "asc" }, take: caps.students + 1 }),
  ]);
  const eligible = new Set(current.map((s) => s.id));
  const ids = [...new Set([...withRows.map((g) => g.studentId), ...eligible])];
  if (ids.length > caps.students) throw unprocessable("RECAP_TOO_LARGE", tooLarge);
  return loadByIds(school, ids, eligible, range, caps, tooLarge);
}

/** Seluruh sekolah (ekspor semua kelas): jumlah baris dijaga lebih dulu dengan count. */
export async function loadSchoolSource(school: MonitorSchool, range: Period, caps: RecapCaps): Promise<RecapSource> {
  const where = { schoolId: school.id, date: dateFilter(range) };
  if ((await prisma.attendance.count({ where })) > caps.rows) throw unprocessable("RECAP_TOO_LARGE", EXPORT_TOO_LARGE);
  const [withRows, current] = await Promise.all([
    prisma.attendance.groupBy({ by: ["studentId"], where, orderBy: { studentId: "asc" }, take: caps.students + 1 }),
    prisma.student.findMany({ where: eligibleOn(school, range.to), select: { id: true }, orderBy: { id: "asc" }, take: caps.students + 1 }),
  ]);
  const eligible = new Set(current.map((s) => s.id));
  const ids = [...new Set([...withRows.map((g) => g.studentId), ...eligible])];
  if (ids.length > caps.students) throw unprocessable("RECAP_TOO_LARGE", EXPORT_TOO_LARGE);
  return loadByIds(school, ids, eligible, range, caps, EXPORT_TOO_LARGE);
}

/**
 * Nama kelas (sekolah ini saja). Nama kelas hanya unik per tahun ajaran: bila dua kelas bernama sama muncul
 * bersama, label diberi tahun ajaran, mis. "X IPA 1 (2025-2026)".
 */
export async function classLabels(schoolId: string, ids: ReadonlyArray<string | null>): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
  if (wanted.length === 0) return new Map();
  const rows = await prisma.schoolClass.findMany({
    where: { schoolId, id: { in: wanted } },
    select: { id: true, name: true, academicYear: { select: { name: true } } },
    take: wanted.length,
  });
  const seen = new Map<string, number>();
  for (const row of rows) seen.set(row.name.toLowerCase(), (seen.get(row.name.toLowerCase()) ?? 0) + 1);
  return new Map(rows.map((row) => [row.id, (seen.get(row.name.toLowerCase()) ?? 0) > 1 ? `${row.name} (${row.academicYear.name.replace("/", "-")})` : row.name]));
}

export const classLabelOf = (id: string | null, labels: ReadonlyMap<string, string>): string =>
  id === null ? NO_CLASS_LABEL : (labels.get(id) ?? DELETED_CLASS_LABEL);

/** GET /school/attendance/monthly-recap: satu kelas satu bulan (maks. 200 siswa di layar). */
export async function getMonthlyRecap(ctx: ActionContext, query: MonthlyRecapQuery, caps: RecapCaps = SCREEN_CAPS): Promise<MonthlyRecapDto> {
  const base = await loadRecapBase(ctx, query.schoolId, query.month);
  const klass = await assertClassInSchool(base.scope, query.classId);
  const source = await loadClassSource(base.school, klass.id, base.range, caps);
  const recap = buildClassRecap({ classKey: klass.id, days: base.days, closedThrough: base.closed, ...source });
  const labels = await classLabels(base.school.id, recap.students.flatMap((s) => s.otherClassIds));
  return toMonthlyRecapDto({ ...base, klass, recap, classLabel: (id) => classLabelOf(id, labels) });
}
