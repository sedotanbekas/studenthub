import type { Prisma } from "@prisma/client";
import { redactForAudit } from "@/lib/audit";
import { requirePrincipal, type ActionContext } from "@/lib/auth/principal";
import { checkSchoolDay } from "@/lib/calendar/rules";
import { loadCalendarContext } from "@/lib/calendar/queries";
import { prisma } from "@/lib/db";
import { pageMeta, type PageMeta } from "@/lib/http/envelope";
import { badRequest, notFound } from "@/lib/http/errors";
import { toSkipTake } from "@/lib/http/pagination";
import { parseStudentSearch } from "@/lib/students/search-rules";
import { resolveSchoolScope, type SchoolScope } from "@/lib/tenant/scope";
import { addDays, fromDbDate, instantAtLocal, localParts, toDbDate, type LocalDate, type SchoolTz } from "@/lib/time/zone";
import { parseFlags } from "./anomaly-rules";
import {
  DETAIL_AUDIT_LIMIT,
  DETAIL_REJECTIONS_LIMIT,
  MAP_POINTS_MAX,
  buildRecap,
  countsFrom,
  resolveRange,
  todayCard,
  type ClassCount,
} from "./attendance-stats";
import { decimalToNumber, fileUrl, flagDetails, timeLocal, toAttendanceBrief, toRejectionBrief, toStudentBrief } from "./monitor-dto";
import type {
  AnomaliesQuery,
  AnomalyRowDto,
  DailyQuery,
  DailyRowDto,
  DailyStatusFilter,
  DateScopeQuery,
  MapDto,
  MapQuery,
  RecapDto,
  RecordDetailDto,
  RejectionRowDto,
  RejectionsQuery,
  TodayStatsDto,
} from "./monitor-schemas";

/**
 * Query baca monitoring absensi admin (selalu ber-SchoolScope & ber-take): kartu hari ini, Data Absensi,
 * Peta Lokasi, Rekap Kelas, detail catatan, antrean anomali, percobaan ditolak.
 */
export const DEFAULT_ANOMALY_RANGE_DAYS = 7;

export interface MonitorSchool {
  readonly id: string;
  readonly timezone: SchoolTz;
  readonly latitude: number;
  readonly longitude: number;
  readonly radiusM: number;
  readonly dayEndMinute: number;
  readonly schoolDaysMask: number;
}

export function monitorScope(ctx: ActionContext, schoolId: string | undefined): SchoolScope {
  return resolveSchoolScope(requirePrincipal(ctx), schoolId);
}

/** Sekolah dalam cakupan; SUPER_ADMIN dengan schoolId tak dikenal -> 404 SCHOOL_NOT_FOUND. */
export async function loadMonitorSchool(scope: SchoolScope): Promise<MonitorSchool> {
  const school = await prisma.school.findUnique({
    where: { id: scope.schoolId },
    select: { id: true, timezone: true, latitude: true, longitude: true, geofenceRadiusM: true, dayEndMinute: true, schoolDaysMask: true },
  });
  if (!school) throw notFound("Sekolah tidak ditemukan.", "SCHOOL_NOT_FOUND");
  return {
    id: school.id,
    timezone: school.timezone,
    latitude: decimalToNumber(school.latitude) ?? 0,
    longitude: decimalToNumber(school.longitude) ?? 0,
    radiusM: school.geofenceRadiusM,
    dayEndMinute: school.dayEndMinute,
    schoolDaysMask: school.schoolDaysMask,
  };
}

export const schoolToday = (school: Pick<MonitorSchool, "timezone">, now: Date): LocalDate => localParts(now, school.timezone).ymd;

export async function isSchoolDayOn(school: MonitorSchool, date: LocalDate): Promise<boolean> {
  const calendar = await loadCalendarContext(prisma, school, { from: date, to: date });
  return checkSchoolDay(date, calendar).isSchoolDay;
}

/** Siswa ACTIVE yang sudah aktif pada tanggal lokal `date` (activatedAt lokal <= date). */
export function eligibleOn(school: Pick<MonitorSchool, "id" | "timezone">, date: LocalDate): Prisma.StudentWhereInput {
  return { schoolId: school.id, status: "ACTIVE", activatedAt: { lt: instantAtLocal(addDays(date, 1), 0, school.timezone) } };
}

/** Siswa layak yang belum punya catatan pada `date` (kelas = kelas saat ini). */
export function notYetWhere(school: Pick<MonitorSchool, "id" | "timezone">, date: LocalDate, classId?: string): Prisma.StudentWhereInput {
  return { ...eligibleOn(school, date), ...(classId ? { currentClassId: classId } : {}), attendances: { none: { date: toDbDate(date) } } };
}

/** Kelas milik sekolah dalam cakupan; kelas sekolah lain / tidak ada -> 404 CLASS_NOT_FOUND. */
export async function assertClassInSchool(scope: SchoolScope, classId: string): Promise<{ id: string; name: string }> {
  const klass = await prisma.schoolClass.findFirst({ where: { id: classId, schoolId: scope.schoolId }, select: { id: true, name: true } });
  if (!klass) throw notFound("Kelas tidak ditemukan.", "CLASS_NOT_FOUND");
  return klass;
}

export const studentBriefSelect = {
  id: true,
  nis: true,
  nisn: true,
  user: { select: { name: true } },
  currentClass: { select: { name: true } },
} satisfies Prisma.StudentSelect;

export type StudentBriefRow = Prisma.StudentGetPayload<{ select: typeof studentBriefSelect }>;

/** Siswa milik sekolah dalam cakupan; siswa sekolah lain / tidak ada -> 404. */
export async function findStudentInSchool(scope: SchoolScope, studentId: string): Promise<StudentBriefRow> {
  const student = await prisma.student.findFirst({ where: { id: studentId, schoolId: scope.schoolId }, select: studentBriefSelect });
  if (!student) throw notFound("Siswa tidak ditemukan.");
  return student;
}

export async function classNames(schoolId: string, ids: ReadonlyArray<string | null>): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
  if (wanted.length === 0) return new Map();
  const rows = await prisma.schoolClass.findMany({ where: { id: { in: wanted }, schoolId }, select: { id: true, name: true }, take: wanted.length });
  return new Map(rows.map((row) => [row.id, row.name]));
}

export const attendanceBriefSelect = {
  id: true,
  status: true,
  source: true,
  checkInAt: true,
  lateMinutes: true,
  distanceM: true,
  accuracyM: true,
  hasAnomaly: true,
  anomalyFlags: true,
  leaveRequestId: true,
  note: true,
} satisfies Prisma.AttendanceSelect;

// ----------------------------------------------------------------------------- kartu hari ini

export async function getTodayStats(ctx: ActionContext, schoolId: string | undefined): Promise<TodayStatsDto> {
  const school = await loadMonitorSchool(monitorScope(ctx, schoolId));
  const local = localParts(ctx.now, school.timezone);
  const eligible = eligibleOn(school, local.ymd);
  const [isSchoolDay, eligibleCount, groups] = await Promise.all([
    isSchoolDayOn(school, local.ymd),
    prisma.student.count({ where: eligible }),
    prisma.attendance.groupBy({ by: ["status"], where: { schoolId: school.id, date: toDbDate(local.ymd), student: eligible }, _count: { _all: true } }),
  ]);
  const counts = countsFrom(groups.map((g) => ({ status: g.status, count: g._count._all })));
  return {
    date: local.ymd,
    isSchoolDay,
    isClosed: local.minuteOfDay >= school.dayEndMinute,
    eligible: eligibleCount,
    ...todayCard({ eligible: eligibleCount, counts, isSchoolDay }),
  };
}

// ----------------------------------------------------------------------------- Data Absensi

function searchFilter(q: string | undefined): Prisma.StudentWhereInput | null {
  const search = parseStudentSearch(q);
  if (!search) return null;
  return {
    OR: [
      { user: { name: { contains: search.nameContains } } },
      { nis: { startsWith: search.nisPrefix } },
      ...(search.nisnPrefix ? [{ nisn: { startsWith: search.nisnPrefix } }] : []),
    ],
  };
}

/** Cabang himpunan siswa: yang punya catatan (sesuai filter) dan/atau yang belum absen (hari sekolah). */
function dailyBranches(query: DailyQuery, isSchoolDay: boolean, withRow: Prisma.StudentWhereInput, waiting: Prisma.StudentWhereInput): Prisma.StudentWhereInput[] {
  if (query.status === "BELUM_ABSEN") return isSchoolDay && !query.anomaly ? [waiting] : [];
  if (query.status || query.anomaly) return [withRow];
  return isSchoolDay ? [withRow, waiting] : [withRow];
}

function dailyWhere(school: MonitorSchool, date: LocalDate, isSchoolDay: boolean, query: DailyQuery): Prisma.StudentWhereInput | null {
  const rowFilter: Prisma.AttendanceWhereInput = {
    date: toDbDate(date),
    ...(query.classId ? { classId: query.classId } : {}),
    ...(query.status && query.status !== "BELUM_ABSEN" ? { status: query.status } : {}),
    ...(query.anomaly ? { hasAnomaly: true } : {}),
  };
  const branches = dailyBranches(query, isSchoolDay, { attendances: { some: rowFilter } }, notYetWhere(school, date, query.classId));
  if (branches.length === 0) return null;
  const search = searchFilter(query.q);
  return { schoolId: school.id, OR: branches, ...(search ? { AND: [search] } : {}) };
}

const DAILY_ORDER: Prisma.StudentOrderByWithRelationInput[] = [{ currentClass: { name: "asc" } }, { user: { name: "asc" } }, { id: "asc" }];

/** Data Absensi satu tanggal, paginasi atas siswa (baris tanpa catatan = belum absen). */
export async function listDaily(ctx: ActionContext, query: DailyQuery): Promise<{ data: DailyRowDto[]; meta: PageMeta }> {
  const scope = monitorScope(ctx, query.schoolId);
  const school = await loadMonitorSchool(scope);
  const date = query.date ?? schoolToday(school, ctx.now);
  if (query.classId) await assertClassInSchool(scope, query.classId);
  const where = dailyWhere(school, date, await isSchoolDayOn(school, date), query);
  if (!where) return { data: [], meta: pageMeta(0, query.page, query.limit) };
  const [total, students] = await Promise.all([
    prisma.student.count({ where }),
    prisma.student.findMany({ where, orderBy: DAILY_ORDER, ...toSkipTake(query), select: studentBriefSelect }),
  ]);
  const rows = await prisma.attendance.findMany({
    where: { schoolId: school.id, date: toDbDate(date), studentId: { in: students.map((s) => s.id) } },
    select: { ...attendanceBriefSelect, studentId: true, schoolClass: { select: { name: true } } },
    take: students.length,
  });
  const byStudent = new Map(rows.map((row) => [row.studentId, row]));
  const data = students.map((student) => {
    const row = byStudent.get(student.id);
    return { student: toStudentBrief(student, row?.schoolClass?.name), attendance: row ? toAttendanceBrief(row, school.timezone) : null };
  });
  return { data, meta: pageMeta(total, query.page, query.limit) };
}

// ----------------------------------------------------------------------------- detail catatan

const detailSelect = {
  ...attendanceBriefSelect,
  studentId: true,
  classId: true,
  date: true,
  latitude: true,
  longitude: true,
  isMocked: true,
  deviceId: true,
  locationCapturedAt: true,
  createdAt: true,
  updatedAt: true,
  schoolClass: { select: { name: true } },
  selfieFile: { select: { id: true, deletedAt: true } },
  student: { select: studentBriefSelect },
} satisfies Prisma.AttendanceSelect;

type DetailRow = Prisma.AttendanceGetPayload<{ select: typeof detailSelect }>;

const auditSelect = {
  id: true,
  action: true,
  before: true,
  after: true,
  createdAt: true,
  actor: { select: { id: true, name: true, role: true } },
} satisfies Prisma.AuditLogSelect;

type AuditRow = Prisma.AuditLogGetPayload<{ select: typeof auditSelect }>;

const rejectionSelect = {
  id: true,
  reason: true,
  latitude: true,
  longitude: true,
  accuracyM: true,
  distanceM: true,
  isMocked: true,
  deviceId: true,
  createdAt: true,
} satisfies Prisma.CheckInRejectionSelect;

function toAuditEntry(row: AuditRow): RecordDetailDto["audit"][number] {
  return {
    id: row.id,
    action: row.action,
    actor: row.actor,
    before: redactForAudit(row.before ?? null),
    after: redactForAudit(row.after ?? null),
    createdAt: row.createdAt.toISOString(),
  };
}

function toSelfie(file: DetailRow["selfieFile"]): RecordDetailDto["selfie"] {
  if (!file) return null;
  const purged = file.deletedAt !== null;
  return { fileId: file.id, url: purged ? null : fileUrl(file.id), purged };
}

function toDetail(row: DetailRow, tz: SchoolTz, extras: Pick<RecordDetailDto, "rejectionsSameDay" | "audit">): RecordDetailDto {
  const brief = toAttendanceBrief(row, tz);
  return {
    ...brief,
    date: fromDbDate(row.date),
    checkInAt: row.checkInAt?.toISOString() ?? null,
    latitude: decimalToNumber(row.latitude),
    longitude: decimalToNumber(row.longitude),
    isMocked: row.isMocked,
    deviceId: row.deviceId,
    locationCapturedAt: row.locationCapturedAt?.toISOString() ?? null,
    flags: flagDetails(brief.flags),
    classId: row.classId,
    className: row.schoolClass?.name ?? null,
    student: toStudentBrief(row.student),
    selfie: toSelfie(row.selfieFile),
    ...extras,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Detail satu catatan + percobaan ditolak di hari yang sama + jejak audit (maks 20). */
export async function getRecordDetail(ctx: ActionContext, id: string, schoolId: string | undefined): Promise<RecordDetailDto> {
  const scope = monitorScope(ctx, schoolId);
  const school = await loadMonitorSchool(scope);
  const row = await prisma.attendance.findFirst({ where: { id, schoolId: scope.schoolId }, select: detailSelect });
  if (!row) throw notFound("Catatan absensi tidak ditemukan.");
  const [rejections, audits] = await Promise.all([
    prisma.checkInRejection.findMany({
      where: { schoolId: scope.schoolId, studentId: row.studentId, date: row.date },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: DETAIL_REJECTIONS_LIMIT,
      select: rejectionSelect,
    }),
    prisma.auditLog.findMany({
      where: { schoolId: scope.schoolId, entityType: "Attendance", entityId: row.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: DETAIL_AUDIT_LIMIT,
      select: auditSelect,
    }),
  ]);
  return toDetail(row, school.timezone, {
    rejectionsSameDay: rejections.map((r) => toRejectionBrief(r, school.timezone)),
    audit: audits.map(toAuditEntry),
  });
}

// ----------------------------------------------------------------------------- anomali & penolakan

/** Antrean anomali (hasAnomaly) dalam rentang <= 92 hari, terbaru dulu. */
export async function listAnomalies(ctx: ActionContext, query: AnomaliesQuery): Promise<{ data: AnomalyRowDto[]; meta: PageMeta }> {
  const scope = monitorScope(ctx, query.schoolId);
  const school = await loadMonitorSchool(scope);
  const range = resolveRange(query.from, query.to, schoolToday(school, ctx.now), DEFAULT_ANOMALY_RANGE_DAYS);
  if (!range) throw badRequest("VALIDATION_FAILED", "Rentang tanggal tidak valid (from <= to, maksimal 92 hari).");
  if (query.classId) await assertClassInSchool(scope, query.classId);
  const where: Prisma.AttendanceWhereInput = {
    schoolId: school.id,
    hasAnomaly: true,
    date: { gte: toDbDate(range.from), lte: toDbDate(range.to) },
    ...(query.classId ? { classId: query.classId } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.attendance.count({ where }),
    prisma.attendance.findMany({
      where,
      orderBy: [{ date: "desc" }, { checkInAt: "asc" }, { id: "asc" }],
      ...toSkipTake(query),
      select: { ...attendanceBriefSelect, date: true, schoolClass: { select: { name: true } }, student: { select: studentBriefSelect } },
    }),
  ]);
  const data = rows.map((row) => ({
    date: fromDbDate(row.date),
    student: toStudentBrief(row.student, row.schoolClass?.name),
    attendance: toAttendanceBrief(row, school.timezone),
  }));
  return { data, meta: pageMeta(total, query.page, query.limit) };
}

/** Percobaan check-in yang ditolak (default hari ini; dengan studentId tanpa date -> semua tanggal). */
export async function listRejections(ctx: ActionContext, query: RejectionsQuery): Promise<{ data: RejectionRowDto[]; meta: PageMeta }> {
  const scope = monitorScope(ctx, query.schoolId);
  const school = await loadMonitorSchool(scope);
  if (query.studentId) await findStudentInSchool(scope, query.studentId);
  const date = query.date ?? (query.studentId ? undefined : schoolToday(school, ctx.now));
  const where: Prisma.CheckInRejectionWhereInput = {
    schoolId: school.id,
    ...(date ? { date: toDbDate(date) } : {}),
    ...(query.studentId ? { studentId: query.studentId } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.checkInRejection.count({ where }),
    prisma.checkInRejection.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...toSkipTake(query),
      select: { ...rejectionSelect, date: true, student: { select: studentBriefSelect } },
    }),
  ]);
  const data = rows.map((row) => ({ ...toRejectionBrief(row, school.timezone), date: fromDbDate(row.date), student: toStudentBrief(row.student) }));
  return { data, meta: pageMeta(total, query.page, query.limit) };
}

// ----------------------------------------------------------------------------- Peta Lokasi

export interface MapOptions {
  /** Batas item per daftar (default MAP_POINTS_MAX); diinjeksi test untuk menguji truncated. */
  readonly maxItems?: number;
}

interface MapFilter {
  readonly school: MonitorSchool;
  readonly date: LocalDate;
  readonly classId?: string;
  readonly status?: DailyStatusFilter;
  readonly isSchoolDay: boolean;
  /** cap + 1 agar pemotongan terdeteksi. */
  readonly take: number;
}

const mapStudentSelect = { id: true, nis: true, user: { select: { name: true } }, currentClass: { select: { name: true } } } satisfies Prisma.StudentSelect;

const mapRowSelect = {
  id: true,
  status: true,
  latitude: true,
  longitude: true,
  accuracyM: true,
  distanceM: true,
  checkInAt: true,
  hasAnomaly: true,
  anomalyFlags: true,
  student: { select: mapStudentSelect },
  schoolClass: { select: { name: true } },
} satisfies Prisma.AttendanceSelect;

type MapRow = Prisma.AttendanceGetPayload<{ select: typeof mapRowSelect }>;
type MapStudent = Prisma.StudentGetPayload<{ select: typeof mapStudentSelect }>;
type Unlocated = MapDto["unlocated"][number];
type MapRejected = NonNullable<MapDto["rejected"]>[number];

function toMapPoint(row: MapRow, tz: SchoolTz): MapDto["points"][number] {
  return {
    attendanceId: row.id,
    studentId: row.student.id,
    name: row.student.user.name,
    nis: row.student.nis,
    className: row.schoolClass?.name ?? row.student.currentClass?.name ?? null,
    status: row.status,
    latitude: decimalToNumber(row.latitude) ?? 0,
    longitude: decimalToNumber(row.longitude) ?? 0,
    accuracyM: row.accuracyM,
    distanceM: row.distanceM,
    checkInTimeLocal: timeLocal(row.checkInAt, tz),
    hasAnomaly: row.hasAnomaly,
    flags: parseFlags(row.anomalyFlags),
  };
}

const toUnlocatedRow = (row: MapRow): Unlocated => ({
  studentId: row.student.id,
  name: row.student.user.name,
  nis: row.student.nis,
  className: row.schoolClass?.name ?? row.student.currentClass?.name ?? null,
  status: row.status,
  attendanceId: row.id,
});

const toWaiting = (student: MapStudent): Unlocated => ({
  studentId: student.id,
  name: student.user.name,
  nis: student.nis,
  className: student.currentClass?.name ?? null,
  status: "BELUM_ABSEN",
  attendanceId: null,
});

function mapRowWhere(f: MapFilter, withStatus: boolean): Prisma.AttendanceWhereInput {
  return {
    schoolId: f.school.id,
    date: toDbDate(f.date),
    ...(f.classId ? { classId: f.classId } : {}),
    ...(withStatus && f.status && f.status !== "BELUM_ABSEN" ? { status: f.status } : {}),
  };
}

async function loadMapRows(f: MapFilter): Promise<{ points: MapRow[]; unlocated: MapRow[] }> {
  if (f.status === "BELUM_ABSEN") return { points: [], unlocated: [] };
  const where = mapRowWhere(f, true);
  const [points, unlocated] = await Promise.all([
    prisma.attendance.findMany({
      where: { ...where, latitude: { not: null }, longitude: { not: null } },
      orderBy: [{ checkInAt: "asc" }, { id: "asc" }],
      take: f.take,
      select: mapRowSelect,
    }),
    prisma.attendance.findMany({
      where: { ...where, OR: [{ latitude: null }, { longitude: null }] },
      orderBy: [{ status: "asc" }, { id: "asc" }],
      take: f.take,
      select: mapRowSelect,
    }),
  ]);
  return { points, unlocated };
}

async function loadWaiting(f: MapFilter): Promise<MapStudent[]> {
  if (!f.isSchoolDay || (f.status && f.status !== "BELUM_ABSEN")) return [];
  return prisma.student.findMany({
    where: notYetWhere(f.school, f.date, f.classId),
    orderBy: [{ user: { name: "asc" } }, { id: "asc" }],
    take: f.take,
    select: mapStudentSelect,
  });
}

/** Jumlah per status (filter kelas saja, bukan filter status) + belum absen. */
async function loadMapCounts(f: MapFilter): Promise<MapDto["counts"]> {
  const [groups, notYet] = await Promise.all([
    prisma.attendance.groupBy({ by: ["status"], where: mapRowWhere(f, false), _count: { _all: true } }),
    f.isSchoolDay ? prisma.student.count({ where: notYetWhere(f.school, f.date, f.classId) }) : Promise.resolve(0),
  ]);
  return { ...countsFrom(groups.map((g) => ({ status: g.status, count: g._count._all }))), notYet };
}

async function loadMapRejected(f: MapFilter): Promise<MapRejected[]> {
  const rows = await prisma.checkInRejection.findMany({
    where: { schoolId: f.school.id, date: toDbDate(f.date), ...(f.classId ? { student: { currentClassId: f.classId } } : {}) },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: f.take,
    select: { ...rejectionSelect, student: { select: mapStudentSelect } },
  });
  return rows.map((row) => ({
    ...toRejectionBrief(row, f.school.timezone),
    studentId: row.student.id,
    name: row.student.user.name,
    className: row.student.currentClass?.name ?? null,
  }));
}

/** Peta Lokasi: titik check-in berkoordinat, daftar tanpa lokasi (izin/sakit/alpha/belum absen), opsional percobaan ditolak. */
export async function getMap(ctx: ActionContext, query: MapQuery, options: MapOptions = {}): Promise<{ data: MapDto; meta: { truncated: boolean } }> {
  const scope = monitorScope(ctx, query.schoolId);
  const school = await loadMonitorSchool(scope);
  const date = query.date ?? schoolToday(school, ctx.now);
  if (query.classId) await assertClassInSchool(scope, query.classId);
  const cap = options.maxItems ?? MAP_POINTS_MAX;
  const f: MapFilter = { school, date, classId: query.classId, status: query.status, isSchoolDay: await isSchoolDayOn(school, date), take: cap + 1 };
  const [rows, waiting, counts, rejected] = await Promise.all([
    loadMapRows(f),
    loadWaiting(f),
    loadMapCounts(f),
    query.includeRejected ? loadMapRejected(f) : Promise.resolve(null),
  ]);
  const unlocated = [...rows.unlocated.map(toUnlocatedRow), ...waiting.map(toWaiting)];
  const truncated = [rows.points.length, unlocated.length, rejected?.length ?? 0].some((n) => n > cap);
  const data: MapDto = {
    date,
    isSchoolDay: f.isSchoolDay,
    school: { latitude: school.latitude, longitude: school.longitude, radiusM: school.radiusM },
    counts,
    points: rows.points.slice(0, cap).map((row) => toMapPoint(row, school.timezone)),
    unlocated: unlocated.slice(0, cap),
    ...(rejected ? { rejected: rejected.slice(0, cap) } : {}),
    truncated,
  };
  return { data, meta: { truncated } };
}

// ----------------------------------------------------------------------------- Rekap Kelas

async function notYetByClass(school: MonitorSchool, date: LocalDate, isSchoolDay: boolean): Promise<ClassCount[]> {
  if (!isSchoolDay) return [];
  const groups = await prisma.student.groupBy({ by: ["currentClassId"], where: notYetWhere(school, date), _count: { _all: true } });
  return groups.map((g) => ({ classId: g.currentClassId, count: g._count._all }));
}

/** Rekap satu hari per kelas (baris tercatat per kelas snapshot + belum absen per kelas saat ini). */
export async function getRecap(ctx: ActionContext, query: DateScopeQuery): Promise<RecapDto> {
  const school = await loadMonitorSchool(monitorScope(ctx, query.schoolId));
  const date = query.date ?? schoolToday(school, ctx.now);
  const isSchoolDay = await isSchoolDayOn(school, date);
  const [groups, notYet] = await Promise.all([
    prisma.attendance.groupBy({ by: ["classId", "status"], where: { schoolId: school.id, date: toDbDate(date) }, _count: { _all: true } }),
    notYetByClass(school, date, isSchoolDay),
  ]);
  const classGroups = groups.map((g) => ({ classId: g.classId, status: g.status, count: g._count._all }));
  const names = await classNames(school.id, [...classGroups.map((g) => g.classId), ...notYet.map((n) => n.classId)]);
  return { date, isSchoolDay, ...buildRecap(classGroups, notYet, names, isSchoolDay) };
}

