/**
 * Pembantu integration test rapor: sekolah dengan semester yang mencakup hari ini ±60 hari, kelas dengan
 * 3 mapel terpetakan (KKM 75/70/80), siswa bertoken, pemanggil route, dan pembuat nilai langsung di DB.
 */
import type { AttendanceSource, AttendanceStatus, School, SchoolClass, Subject, Term } from "@prisma/client";
import { GET as getCardRoute, DELETE as deleteCardRoute } from "@/app/api/v1/school/report-cards/[id]/route";
import { PUT as cardGradesRoute } from "@/app/api/v1/school/report-cards/[id]/grades/route";
import { PUT as bulkGradesRoute } from "@/app/api/v1/school/report-cards/grades/route";
import { POST as publishRoute } from "@/app/api/v1/school/report-cards/publish/route";
import { GET as readinessRoute } from "@/app/api/v1/school/report-cards/readiness/route";
import { GET as listRoute, POST as createRoute } from "@/app/api/v1/school/report-cards/route";
import { GET as sheetRoute } from "@/app/api/v1/school/report-cards/sheet/route";
import { POST as unpublishRoute } from "@/app/api/v1/school/report-cards/unpublish/route";
import { GET as ownDetailRoute } from "@/app/api/v1/student/report-cards/[id]/route";
import { GET as ownListRoute } from "@/app/api/v1/student/report-cards/route";
import { AUTO_ALPHA_JOB } from "@/lib/attendance/auto-alpha-rules";
import { addDays, eachDate, localParts, toDbDate, type LocalDate } from "@/lib/time/zone";
import { createSessionToken } from "../helpers/auth";
import { prisma, uniq } from "../helpers/db";
import {
  createAcademicYearWithTerm,
  createClass,
  createSchool,
  createSchoolAdmin,
  createStudent,
  createSuperAdmin,
  type CreateStudentOptions,
  type TestStudent,
} from "../helpers/factories";
import { callRoute, type Envelope } from "../helpers/request";

export const todayWib = (): LocalDate => localParts(new Date(), "WIB").ymd;

export async function webToken(userId: string): Promise<string> {
  return (await createSessionToken(userId, { platform: "WEB", deviceId: null })).token;
}

export async function superAdminToken(): Promise<string> {
  return webToken((await createSuperAdmin()).id);
}

export interface StudentWithToken extends TestStudent {
  readonly token: string;
}

export interface RcWorld {
  readonly school: School;
  readonly term: Term;
  readonly termStart: LocalDate;
  readonly termEnd: LocalDate;
  readonly academicYearId: string;
  readonly klass: SchoolClass;
  /** [B. Indonesia (KKM 70), Matematika (KKM 75), IPA (KKM 80)] dalam urutan sortOrder kelas. */
  readonly subjects: readonly [Subject, Subject, Subject];
  readonly adminToken: string;
  readonly students: StudentWithToken[];
}

export async function createSubject(schoolId: string, name: string, kkm: number): Promise<Subject> {
  return prisma.subject.create({ data: { schoolId, code: uniq("S").slice(0, 20).toUpperCase(), name, kkm } });
}

export async function mapSubjects(classId: string, subjectIds: readonly string[]): Promise<void> {
  await prisma.classSubject.createMany({ data: subjectIds.map((subjectId, sortOrder) => ({ classId, subjectId, sortOrder })) });
}

export async function addStudent(world: Pick<RcWorld, "school" | "klass">, options: CreateStudentOptions = {}): Promise<StudentWithToken> {
  const created = await createStudent(world.school.id, { classId: world.klass.id, ...options });
  return { ...created, token: (await createSessionToken(created.user.id)).token };
}

/** Tandai hari [from, to] sudah ditutup auto-ALPHA (JobRun SUCCEEDED), seperti tick cron di produksi. */
export async function closeAttendanceDays(schoolId: string, from: LocalDate, to: LocalDate): Promise<void> {
  await prisma.jobRun.createMany({
    data: eachDate(from, to).map((runKey) => ({ job: AUTO_ALPHA_JOB, scopeKey: schoolId, runKey, status: "SUCCEEDED" as const, finishedAt: new Date() })),
    skipDuplicates: true,
  });
}

/**
 * Sekolah + semester aktif (hari ini -60 .. +60) + kelas + 3 mapel terpetakan + admin + N siswa aktif.
 * Hari awal semester s.d. hari ini sudah ditutup auto-ALPHA (rekap rapor final).
 */
export async function createRcWorld(studentCount = 3): Promise<RcWorld> {
  const school = await createSchool();
  const today = todayWib();
  const [termStart, termEnd] = [addDays(today, -60), addDays(today, 60)];
  await closeAttendanceDays(school.id, termStart, today);
  const { academicYear, term } = await createAcademicYearWithTerm(school.id, {
    yearStart: addDays(today, -120), yearEnd: addDays(today, 200), termStart, termEnd,
  });
  const klass = await createClass(school.id, academicYear.id, { name: uniq("VIII") });
  const subjects = [await createSubject(school.id, "Bahasa Indonesia", 70), await createSubject(school.id, "Matematika", 75), await createSubject(school.id, "IPA", 80)] as const;
  await mapSubjects(klass.id, subjects.map((s) => s.id));
  const admin = await createSchoolAdmin(school.id);
  const base = { school, term, termStart, termEnd, academicYearId: academicYear.id, klass, subjects, adminToken: await webToken(admin.id) };
  const students: StudentWithToken[] = [];
  for (let i = 0; i < studentCount; i += 1) students.push(await addStudent(base, { name: `Siswa ${String.fromCharCode(65 + i)} ${uniq("n")}` }));
  return { ...base, students };
}

export async function addAttendance(schoolId: string, studentId: string, date: LocalDate, status: AttendanceStatus): Promise<void> {
  const source: AttendanceSource = status === "ALPHA" ? "AUTO_ALPHA" : "ADMIN";
  await prisma.attendance.create({ data: { schoolId, studentId, date: toDbDate(date), status, source } });
}

// ----------------------------------------------------------------------------- pemanggil route

const BASE = "/api/v1/school/report-cards";

export function withSchool(url: string, schoolId?: string): string {
  if (!schoolId) return url;
  return `${url}${url.includes("?") ? "&" : "?"}schoolId=${encodeURIComponent(schoolId)}`;
}

export interface BulkResult { updated: number; unchanged: number; deleted: number; createdReportCards: number }
export interface GradeView { subjectId: string; subjectName: string; kkm: number; score: number; predicate: string; description: string | null; isMapped: boolean }
export interface CardDetail {
  id: string;
  student: { id: string; name: string; nis: string };
  term: { id: string; label: string };
  classId: string;
  className: string;
  status: "DRAFT" | "PUBLISHED";
  publishedAt: string | null;
  grades: GradeView[];
  missingSubjectIds: string[];
  attendanceSummary: { sick: number; permit: number; absent: number; isSnapshot: boolean; unclosedDates: string[] };
  average: number | null;
}
export interface Readiness {
  subjectCount: number;
  ready: Array<{ reportCardId: string; studentId: string }>;
  incomplete: Array<{ reportCardId: string; studentId: string; missingSubjectIds: string[] }>;
  noReportCard: string[];
  published: Array<{ reportCardId: string; studentId: string }>;
  attendanceUnclosedDates: string[];
}

type Entry = { studentId: string; score: number | null; description?: string | null };

export const putBulk = (token: string, body: unknown, schoolId?: string) =>
  callRoute<Envelope<BulkResult>>(bulkGradesRoute, { method: "PUT", url: withSchool(`${BASE}/grades`, schoolId), bearer: token, json: body });

export function bulkBody(world: RcWorld, subjectIndex: 0 | 1 | 2, entries: readonly Entry[]) {
  return { termId: world.term.id, classId: world.klass.id, subjectId: world.subjects[subjectIndex].id, entries };
}

export const putCardGrades = (token: string, id: string, grades: unknown, schoolId?: string) =>
  callRoute<Envelope<CardDetail>>(cardGradesRoute, { method: "PUT", url: withSchool(`${BASE}/${id}/grades`, schoolId), bearer: token, json: { grades }, params: { id } });

export const getCard = (token: string, id: string, schoolId?: string) =>
  callRoute<Envelope<CardDetail>>(getCardRoute, { method: "GET", url: withSchool(`${BASE}/${id}`, schoolId), bearer: token, params: { id } });

export const deleteCard = (token: string, id: string, schoolId?: string) =>
  callRoute<Envelope<{ id: string }>>(deleteCardRoute, { method: "DELETE", url: withSchool(`${BASE}/${id}`, schoolId), bearer: token, params: { id } });

export const createCard = (token: string, body: unknown, schoolId?: string) =>
  callRoute<Envelope<CardDetail>>(createRoute, { method: "POST", url: withSchool(BASE, schoolId), bearer: token, json: body });

export const listCards = (token: string, query = "") =>
  callRoute<Envelope<Array<CardDetail & { gradedCount: number; expectedCount: number }>>>(listRoute, { method: "GET", url: `${BASE}${query}`, bearer: token });

export const getSheet = (token: string, query: string) =>
  callRoute<Envelope<{ rows: Array<Record<string, unknown>>; subject: { kkm: number } }>>(sheetRoute, { method: "GET", url: `${BASE}/sheet${query}`, bearer: token });

export const getReadiness = (token: string, query: string) =>
  callRoute<Envelope<Readiness>>(readinessRoute, { method: "GET", url: `${BASE}/readiness${query}`, bearer: token });

export const publish = (token: string, body: unknown, schoolId?: string) =>
  callRoute<Envelope<{ publishedIds: string[]; notified: number }>>(publishRoute, { method: "POST", url: withSchool(`${BASE}/publish`, schoolId), bearer: token, json: body });

export const unpublish = (token: string, body: unknown, schoolId?: string) =>
  callRoute<Envelope<{ unpublishedIds: string[] }>>(unpublishRoute, { method: "POST", url: withSchool(`${BASE}/unpublish`, schoolId), bearer: token, json: body });

export const ownList = (token: string) =>
  callRoute<Envelope<Array<{ id: string; termLabel: string; className: string; publishedAt: string; average: number | null }>>>(ownListRoute, {
    method: "GET", url: "/api/v1/student/report-cards", bearer: token,
  });

export const ownDetail = (token: string, id: string) =>
  callRoute<Envelope<{ grades: Array<{ subjectName: string; kkm: number; score: number; predicate: string }>; attendance: { sick: number; permit: number; absent: number }; average: number | null }>>(
    ownDetailRoute,
    { method: "GET", url: `/api/v1/student/report-cards/${id}`, bearer: token, params: { id } },
  );

/** Isi semua mapel untuk siswa-siswa (lewat API bulk) dengan nilai yang sama. */
export async function gradeAll(world: RcWorld, studentIds: readonly string[], score: number): Promise<void> {
  for (const index of [0, 1, 2] as const) {
    const res = await putBulk(world.adminToken, bulkBody(world, index, studentIds.map((studentId) => ({ studentId, score }))));
    if (res.status !== 200) throw new Error(`gradeAll gagal: ${JSON.stringify(res.body?.error)}`);
  }
}

export async function cardIdOf(world: RcWorld, studentId: string): Promise<string> {
  const card = await prisma.reportCard.findFirst({ where: { schoolId: world.school.id, studentId, termId: world.term.id }, select: { id: true } });
  if (!card) throw new Error("Rapor tidak ditemukan");
  return card.id;
}

export const termQuery = (world: RcWorld, extra = ""): string => `?termId=${world.term.id}&classId=${world.klass.id}${extra}`;
