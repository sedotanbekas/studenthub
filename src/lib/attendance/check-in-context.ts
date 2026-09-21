import type { SchoolTimezone, StudentStatus } from "@prisma/client";
import { requirePrincipal, type ActionContext, type Principal } from "@/lib/auth/principal";
import { loadCalendarContext } from "@/lib/calendar/queries";
import { checkSchoolDay, type DayCheck } from "@/lib/calendar/rules";
import { prisma, type Tx } from "@/lib/db";
import { forbidden, notFound } from "@/lib/http/errors";
import { studentSelf } from "@/lib/tenant/scope";
import { localParts, toDbDate, type LocalDate, type LocalParts } from "@/lib/time/zone";
import type { CheckInDecisionInput, GeofencePolicy, LocationFix, SchedulePolicy } from "./check-in-rules";
import { DUPLICATE_SELFIE_LOOKBACK_DAYS, DUPLICATE_SELFIE_MAX_CANDIDATES, NEW_DEVICE_WINDOW_DAYS } from "./constants";
import { ATTENDANCE_ROW_SELECT, type AttendanceRow } from "./student-dto";

/**
 * Pemuat konteks check-in (baca saja): siswa & sekolah dari principal (id TIDAK PERNAH dari body),
 * waktu lokal sekolah menurut jam server, status hari sekolah, dan baris absensi hari ini.
 */
export interface CheckInSchool {
  readonly id: string;
  readonly timezone: SchoolTimezone;
  readonly geofence: GeofencePolicy;
  readonly schedule: SchedulePolicy;
  readonly dayEndMinute: number;
  readonly schoolDaysMask: number;
}

export interface CheckInStudent {
  readonly id: string;
  readonly userId: string;
  readonly schoolId: string;
  readonly status: StudentStatus;
  readonly currentClassId: string | null;
  readonly deviceBoundAt: Date | null;
}

export interface StudentSchool {
  readonly principal: Principal;
  readonly student: CheckInStudent;
  readonly school: CheckInSchool;
}

export interface CheckInContext extends StudentSchool {
  readonly local: LocalParts;
  readonly day: DayCheck;
  readonly existing: AttendanceRow | null;
}

const DAY_MS = 86_400_000;

async function loadSchool(schoolId: string): Promise<CheckInSchool> {
  const row = await prisma.school.findUnique({
    where: { id: schoolId },
    select: {
      id: true, timezone: true, latitude: true, longitude: true, geofenceRadiusM: true, checkInOpenMinute: true, startMinute: true,
      lateToleranceMinutes: true, checkInCloseMinute: true, dayEndMinute: true, schoolDaysMask: true,
    },
  });
  if (!row) throw notFound("Sekolah tidak ditemukan.");
  return {
    id: row.id,
    timezone: row.timezone,
    geofence: { latitude: row.latitude.toNumber(), longitude: row.longitude.toNumber(), radiusM: row.geofenceRadiusM },
    schedule: {
      openMinute: row.checkInOpenMinute,
      startMinute: row.startMinute,
      lateToleranceMinutes: row.lateToleranceMinutes,
      closeMinute: row.checkInCloseMinute,
    },
    dayEndMinute: row.dayEndMinute,
    schoolDaysMask: row.schoolDaysMask,
  };
}

/** Siswa & sekolah milik principal STUDENT (status tidak diperiksa; lihat loadCheckInContext). */
export async function loadStudentSchool(ctx: ActionContext): Promise<StudentSchool> {
  const principal = requirePrincipal(ctx);
  const self = studentSelf(principal);
  const [student, school] = await Promise.all([
    prisma.student.findFirst({
      where: { id: self.studentId, schoolId: self.schoolId, userId: self.userId },
      select: { id: true, userId: true, schoolId: true, status: true, currentClassId: true, deviceBoundAt: true },
    }),
    loadSchool(self.schoolId),
  ]);
  if (!student) throw notFound("Data siswa tidak ditemukan.");
  return { principal, student, school };
}

/** Baris absensi (siswa, tanggal lokal) bila ada. */
export async function findAttendance(db: Tx, student: Pick<CheckInStudent, "id" | "schoolId">, date: LocalDate): Promise<AttendanceRow | null> {
  return db.attendance.findFirst({
    where: { studentId: student.id, schoolId: student.schoolId, date: toDbDate(date) },
    select: ATTENDANCE_ROW_SELECT,
  });
}

/** Konteks lengkap untuk today/precheck/check-in. Siswa harus ACTIVE (dicek ulang dari DB). */
export async function loadCheckInContext(ctx: ActionContext): Promise<CheckInContext> {
  const base = await loadStudentSchool(ctx);
  if (base.student.status !== "ACTIVE") throw forbidden("STUDENT_NOT_ACTIVE", "Akun siswa tidak aktif untuk absensi.");
  const local = localParts(ctx.now, base.school.timezone);
  const [calendar, existing] = await Promise.all([
    loadCalendarContext(prisma, { id: base.school.id, schoolDaysMask: base.school.schoolDaysMask }, { from: local.ymd, to: local.ymd }),
    findAttendance(prisma, base.student, local.ymd),
  ]);
  return { ...base, local, day: checkSchoolDay(local.ymd, calendar), existing };
}

export function decisionInputOf(context: CheckInContext, fix: LocationFix): CheckInDecisionInput {
  return {
    existingSource: context.existing?.source ?? null,
    day: context.day,
    minuteOfDay: context.local.minuteOfDay,
    schedule: context.school.schedule,
    geofence: context.school.geofence,
    fix,
  };
}

export interface AnomalyEvidence {
  readonly recentSelfiePhashes: readonly string[];
  readonly deviceBeforeBinding: string | null;
}

/** dHash selfie siswa ini (60 hari) — dasar DUPLICATE_SELFIE. */
async function recentSelfiePhashes(student: CheckInStudent, now: Date): Promise<string[]> {
  const rows = await prisma.storedFile.findMany({
    where: {
      kind: "ATTENDANCE_SELFIE",
      uploadedById: student.userId,
      schoolId: student.schoolId,
      createdAt: { gte: new Date(now.getTime() - DUPLICATE_SELFIE_LOOKBACK_DAYS * DAY_MS) },
      phash: { not: null },
    },
    orderBy: { createdAt: "desc" },
    select: { phash: true },
    take: DUPLICATE_SELFIE_MAX_CANDIDATES,
  });
  return rows.flatMap((row) => (row.phash ? [row.phash] : []));
}

/** deviceId check-in terakhir sebelum perangkat diikat ulang (hanya bila pengikatan <= 7 hari). */
async function deviceBeforeBinding(student: CheckInStudent, now: Date): Promise<string | null> {
  const boundAt = student.deviceBoundAt;
  if (boundAt === null || now.getTime() - boundAt.getTime() > NEW_DEVICE_WINDOW_DAYS * DAY_MS) return null;
  const previous = await prisma.attendance.findFirst({
    where: { studentId: student.id, schoolId: student.schoolId, checkInAt: { lt: boundAt }, deviceId: { not: null } },
    orderBy: { checkInAt: "desc" },
    select: { deviceId: true },
  });
  return previous?.deviceId ?? null;
}

/** Bukti anomali milik siswa sendiri (dibaca di luar transaksi; best effort). */
export async function loadAnomalyEvidence(student: CheckInStudent, now: Date): Promise<AnomalyEvidence> {
  const [phashes, previousDevice] = await Promise.all([recentSelfiePhashes(student, now), deviceBeforeBinding(student, now)]);
  return { recentSelfiePhashes: phashes, deviceBeforeBinding: previousDevice };
}
