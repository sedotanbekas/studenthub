import type { Prisma } from "@prisma/client";
import { requirePrincipal, type ActionContext } from "@/lib/auth/principal";
import { loadCalendarContext } from "@/lib/calendar/queries";
import { listSchoolDays } from "@/lib/calendar/rules";
import { prisma, type Tx } from "@/lib/db";
import { pageMeta, type PageMeta } from "@/lib/http/envelope";
import { notFound } from "@/lib/http/errors";
import { likeSearch } from "@/lib/http/like";
import { toSkipTake } from "@/lib/http/pagination";
import { resolveSchoolScope, studentSelf, type SchoolScope } from "@/lib/tenant/scope";
import { toDbDate, type LocalDate, type SchoolTz } from "@/lib/time/zone";
import { LEAVE_SELECT, SCHOOL_LEAVE_SELECT, rangeOf, toLeaveDto, toSchoolLeaveDto } from "./leave-dto";
import type { LeaveRequestDto, OwnLeavesQuery, SchoolLeaveDetailDto, SchoolLeaveDto, SchoolLeavesQuery } from "./leave-schemas";

/**
 * Query baca izin/sakit (selalu ber-scope & ber-take). schoolDayCount dihitung dari kalender sekolah
 * SAAT INI (satu konteks kalender per halaman).
 */
export interface LeaveSchool {
  readonly id: string;
  readonly timezone: SchoolTz;
  readonly schoolDaysMask: number;
  /** Batas wajib absen (auto-alpha-rules.firstEligibleDate) untuk materialisasi izin. */
  readonly checkInCloseMinute: number;
}

interface DateRangeLike {
  readonly startDate: LocalDate;
  readonly endDate: LocalDate;
}

export function leaveScopeOf(ctx: ActionContext, schoolId: string | undefined): SchoolScope {
  return resolveSchoolScope(requirePrincipal(ctx), schoolId);
}

/** Sekolah dalam cakupan (School tidak ber-schoolId; SUPER_ADMIN dengan id tak dikenal -> 404). */
export async function loadLeaveSchool(db: Tx, schoolId: string): Promise<LeaveSchool> {
  const school = await db.school.findUnique({ where: { id: schoolId }, select: { id: true, timezone: true, schoolDaysMask: true, checkInCloseMinute: true } });
  if (!school) throw notFound("Sekolah tidak ditemukan.", "SCHOOL_NOT_FOUND");
  return school;
}

/** Hari sekolah per rentang, memakai satu konteks kalender yang mencakup semua rentang. */
export async function schoolDaysOf(db: Tx, school: LeaveSchool, ranges: readonly DateRangeLike[]): Promise<LocalDate[][]> {
  if (ranges.length === 0) return [];
  const from = ranges.reduce((min, r) => (r.startDate < min ? r.startDate : min), ranges[0]?.startDate ?? "");
  const to = ranges.reduce((max, r) => (r.endDate > max ? r.endDate : max), ranges[0]?.endDate ?? "");
  const calendar = await loadCalendarContext(db, school, { from, to });
  return ranges.map((r) => listSchoolDays(r.startDate, r.endDate, calendar));
}

async function schoolDayCounts(db: Tx, school: LeaveSchool, rows: readonly { startDate: Date; endDate: Date }[]): Promise<number[]> {
  const days = await schoolDaysOf(db, school, rows.map(rangeOf));
  return days.map((list) => list.length);
}

const notFoundLeave = () => notFound("Pengajuan izin tidak ditemukan.");

// ----------------------------------------------------------------------------- siswa

export async function listOwnLeaves(ctx: ActionContext, query: OwnLeavesQuery): Promise<{ data: LeaveRequestDto[]; meta: PageMeta }> {
  const self = studentSelf(requirePrincipal(ctx));
  const school = await loadLeaveSchool(prisma, self.schoolId);
  const where: Prisma.LeaveRequestWhereInput = {
    schoolId: self.schoolId,
    studentId: self.studentId,
    ...(query.status ? { status: query.status } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.leaveRequest.count({ where }),
    prisma.leaveRequest.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], ...toSkipTake(query), select: LEAVE_SELECT }),
  ]);
  const counts = await schoolDayCounts(prisma, school, rows);
  return { data: rows.map((row, i) => toLeaveDto(row, counts[i] ?? 0)), meta: pageMeta(total, query.page, query.limit) };
}

/** Detail milik siswa sendiri; id milik siswa lain -> 404. */
export async function getOwnLeave(ctx: ActionContext, id: string): Promise<LeaveRequestDto> {
  const self = studentSelf(requirePrincipal(ctx));
  const row = await prisma.leaveRequest.findFirst({ where: { id, schoolId: self.schoolId, studentId: self.studentId }, select: LEAVE_SELECT });
  if (!row) throw notFoundLeave();
  const [count = 0] = await schoolDayCounts(prisma, await loadLeaveSchool(prisma, self.schoolId), [row]);
  return toLeaveDto(row, count);
}

// ----------------------------------------------------------------------------- admin

function schoolLeavesWhere(scope: SchoolScope, query: SchoolLeavesQuery): Prisma.LeaveRequestWhereInput {
  const q = likeSearch(query.q);
  const studentFilter: Prisma.StudentWhereInput = {
    ...(query.classId ? { currentClassId: query.classId } : {}),
    ...(q ? { OR: [{ user: { name: { contains: q } } }, { nis: { startsWith: q } }] } : {}),
  };
  return {
    schoolId: scope.schoolId,
    ...(query.status === "ALL" ? {} : { status: query.status }),
    ...(query.to ? { startDate: { lte: toDbDate(query.to) } } : {}),
    ...(query.from ? { endDate: { gte: toDbDate(query.from) } } : {}),
    ...(Object.keys(studentFilter).length > 0 ? { student: studentFilter } : {}),
  };
}

/** Antrean PENDING: terlama dulu; status lain: terbaru dulu. */
const schoolLeavesOrder = (status: SchoolLeavesQuery["status"]): Prisma.LeaveRequestOrderByWithRelationInput[] =>
  status === "PENDING" ? [{ createdAt: "asc" }, { id: "asc" }] : [{ createdAt: "desc" }, { id: "desc" }];

export async function listSchoolLeaves(ctx: ActionContext, query: SchoolLeavesQuery): Promise<{ data: SchoolLeaveDto[]; meta: PageMeta }> {
  const scope = leaveScopeOf(ctx, query.schoolId);
  const school = await loadLeaveSchool(prisma, scope.schoolId);
  const where = schoolLeavesWhere(scope, query);
  const [total, rows] = await Promise.all([
    prisma.leaveRequest.count({ where }),
    prisma.leaveRequest.findMany({ where, orderBy: schoolLeavesOrder(query.status), ...toSkipTake(query), select: SCHOOL_LEAVE_SELECT }),
  ]);
  const counts = await schoolDayCounts(prisma, school, rows);
  return { data: rows.map((row, i) => toSchoolLeaveDto(row, counts[i] ?? 0)), meta: pageMeta(total, query.page, query.limit) };
}

/** Item admin (respons approve/reject/input admin). */
export async function loadSchoolLeaveItem(db: Tx, scope: SchoolScope, id: string): Promise<SchoolLeaveDto> {
  const row = await db.leaveRequest.findFirst({ where: { id, schoolId: scope.schoolId }, select: SCHOOL_LEAVE_SELECT });
  if (!row) throw notFoundLeave();
  const [count = 0] = await schoolDayCounts(db, await loadLeaveSchool(db, scope.schoolId), [row]);
  return toSchoolLeaveDto(row, count);
}

export async function getSchoolLeave(ctx: ActionContext, schoolId: string | undefined, id: string): Promise<SchoolLeaveDetailDto> {
  const scope = leaveScopeOf(ctx, schoolId);
  const school = await loadLeaveSchool(prisma, scope.schoolId);
  const row = await prisma.leaveRequest.findFirst({
    where: { id, schoolId: scope.schoolId },
    select: { ...SCHOOL_LEAVE_SELECT, reviewedBy: { select: { id: true, name: true } } },
  });
  if (!row) throw notFoundLeave();
  const { reviewedBy, ...rest } = row;
  const [schoolDays = []] = await schoolDaysOf(prisma, school, [rangeOf(rest)]);
  return { ...toSchoolLeaveDto(rest, schoolDays.length), schoolDays, reviewedBy };
}
