/**
 * Fixture integration test monitoring & analitik absensi: sekolah dengan semester 2091 (tahun jauh
 * agar tidak bertabrakan dengan libur nasional test lain), kelas, siswa bernama terkontrol, baris
 * absensi sumber ADMIN (tanpa selfie), dan konteks aksi dengan jam yang diinjeksi.
 */
import type { AttendanceStatus, School, SchoolTimezone } from "@prisma/client";
import type { ActionContext } from "@/lib/auth/principal";
import { makePrincipal } from "@/lib/auth/test-principal";
import { toDbDate, type LocalDate } from "@/lib/time/zone";
import { createSessionToken } from "../../helpers/auth";
import { prisma, uniq } from "../../helpers/db";
import {
  createAcademicYearWithTerm,
  createClass,
  createSchool,
  createSchoolAdmin,
  createStudent,
  createSuperAdmin,
  type CreateStudentOptions,
} from "../../helpers/factories";

export const TERM_START = "2091-01-02";
export const TERM_END = "2091-06-29";

export interface MonitorSchool {
  readonly school: School;
  readonly adminId: string;
  readonly adminToken: string;
  readonly academicYearId: string;
}

export async function webToken(userId: string): Promise<string> {
  return (await createSessionToken(userId, { platform: "WEB", deviceId: null })).token;
}

/** Sekolah Sen-Jum dengan semester Genap 2091 + admin sekolah bertoken. */
export async function createMonitorSchool(timezone: SchoolTimezone = "WIB"): Promise<MonitorSchool> {
  const school = await createSchool({ timezone, data: { schoolDaysMask: 31 } });
  const { academicYear } = await createAcademicYearWithTerm(school.id, {
    name: "2090/2091",
    yearStart: "2090-07-02",
    yearEnd: TERM_END,
    semester: "GENAP",
    termStart: TERM_START,
    termEnd: TERM_END,
  });
  const admin = await createSchoolAdmin(school.id);
  return { school, adminId: admin.id, adminToken: await webToken(admin.id), academicYearId: academicYear.id };
}

export async function createSuperToken(): Promise<string> {
  return webToken((await createSuperAdmin()).id);
}

export async function createNamedClass(tenant: MonitorSchool, name: string): Promise<string> {
  return (await createClass(tenant.school.id, tenant.academicYearId, { name: `${name}-${uniq("k").slice(-6)}` })).id;
}

/** Siswa dengan nama berawalan terkontrol (urutan nama deterministik dalam satu sekolah). */
export async function createNamedStudent(schoolId: string, name: string, options: CreateStudentOptions = {}): Promise<{ id: string; userId: string; nis: string }> {
  const { student, user } = await createStudent(schoolId, { name, ...options });
  return { id: student.id, userId: user.id, nis: student.nis };
}

export interface RowInput {
  readonly schoolId: string;
  readonly studentId: string;
  readonly classId: string | null;
  readonly date: LocalDate;
  readonly status: AttendanceStatus;
  readonly lateMinutes?: number;
  readonly latitude?: string;
  readonly longitude?: string;
  readonly accuracyM?: number;
  readonly distanceM?: number;
  readonly checkInAt?: Date;
  readonly hasAnomaly?: boolean;
  readonly anomalyFlags?: string[];
}

/** Baris absensi sumber ADMIN (lolos semua CHECK tanpa selfie). */
export function rowData(input: RowInput) {
  return {
    schoolId: input.schoolId,
    studentId: input.studentId,
    classId: input.classId,
    date: toDbDate(input.date),
    status: input.status,
    source: "ADMIN" as const,
    lateMinutes: input.status === "TERLAMBAT" ? (input.lateMinutes ?? 10) : null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    accuracyM: input.accuracyM ?? null,
    distanceM: input.distanceM ?? null,
    checkInAt: input.checkInAt ?? null,
    hasAnomaly: input.hasAnomaly ?? false,
    anomalyFlags: input.anomalyFlags ?? undefined,
    note: "fixture",
  };
}

export async function addRows(rows: readonly RowInput[]): Promise<void> {
  await prisma.attendance.createMany({ data: rows.map(rowData) });
}

export function adminCtx(tenant: MonitorSchool, now: Date): ActionContext {
  return {
    principal: makePrincipal({ userId: tenant.adminId, role: "SCHOOL_ADMIN", schoolId: tenant.school.id }),
    now,
    requestId: uniq("req"),
    ip: null,
    userAgent: null,
    defer: () => undefined,
  };
}

/** Tambahkan ?schoolId= / &schoolId= bila diisi. */
export function withSchool(url: string, schoolId?: string): string {
  if (!schoolId) return url;
  return `${url}${url.includes("?") ? "&" : "?"}schoolId=${encodeURIComponent(schoolId)}`;
}
