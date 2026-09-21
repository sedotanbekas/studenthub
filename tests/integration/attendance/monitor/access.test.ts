/**
 * Gerbang peran & isolasi tenant untuk SEMUA endpoint monitoring/analitik absensi (dua sekolah):
 * tanpa token 401, siswa 403, admin sekolah dengan schoolId lain 403, super admin tanpa schoolId 400,
 * super admin dengan sekolah tak dikenal 404, id milik sekolah lain 404, admin sendiri & super admin 200.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { GET as detailRoute } from "@/app/api/v1/school/attendance/[id]/route";
import { GET as classAnalyticsRoute } from "@/app/api/v1/school/attendance/analytics/classes/route";
import { GET as classTrendRoute } from "@/app/api/v1/school/attendance/analytics/classes/[classId]/trend/route";
import { GET as studentTrendRoute } from "@/app/api/v1/school/attendance/analytics/students/[studentId]/route";
import { GET as summaryRoute } from "@/app/api/v1/school/attendance/analytics/summary/route";
import { GET as anomaliesRoute } from "@/app/api/v1/school/attendance/anomalies/route";
import { GET as dailyRoute } from "@/app/api/v1/school/attendance/daily/route";
import { GET as mapRoute } from "@/app/api/v1/school/attendance/map/route";
import { GET as recapRoute } from "@/app/api/v1/school/attendance/recap/route";
import { GET as rejectionsRoute } from "@/app/api/v1/school/attendance/rejections/route";
import { GET as todayRoute } from "@/app/api/v1/school/attendance/stats/today/route";
import { GET as studentMonthRoute } from "@/app/api/v1/school/attendance/students/[studentId]/month/route";
import { createSessionToken } from "../../helpers/auth";
import { disconnect, prisma } from "../../helpers/db";
import { createSchoolAdmin } from "../../helpers/factories";
import { callRoute, type AnyRouteHandler } from "../../helpers/request";
import { addRows, createMonitorSchool, createNamedClass, createNamedStudent, createSuperToken, webToken, withSchool, type MonitorSchool } from "./fixtures";

interface Endpoint {
  readonly name: string;
  readonly handler: AnyRouteHandler;
  readonly path: string;
  readonly params?: Record<string, string>;
  /** Id tenant A di path (IDOR bila dibuka admin sekolah B). */
  readonly ownsId?: boolean;
}

let a: MonitorSchool;
let b: MonitorSchool;
let superToken = "";
let studentToken = "";
let endpoints: Endpoint[] = [];

before(async () => {
  a = await createMonitorSchool();
  b = await createMonitorSchool();
  superToken = await createSuperToken();
  const classId = await createNamedClass(a, "VII-A");
  const student = await createNamedStudent(a.school.id, "Siswa A", { classId });
  studentToken = (await createSessionToken(student.userId)).token;
  await addRows([{ schoolId: a.school.id, studentId: student.id, classId, date: "2091-03-12", status: "HADIR" }]);
  const row = await prisma.attendance.findFirstOrThrow({ where: { studentId: student.id }, select: { id: true } });
  const base = "/api/v1/school/attendance";
  endpoints = [
    { name: "stats/today", handler: todayRoute, path: `${base}/stats/today` },
    { name: "daily", handler: dailyRoute, path: `${base}/daily?date=2091-03-12` },
    { name: "map", handler: mapRoute, path: `${base}/map?date=2091-03-12&includeRejected=true` },
    { name: "recap", handler: recapRoute, path: `${base}/recap?date=2091-03-12` },
    { name: "anomalies", handler: anomaliesRoute, path: `${base}/anomalies` },
    { name: "rejections", handler: rejectionsRoute, path: `${base}/rejections` },
    { name: "analytics/classes", handler: classAnalyticsRoute, path: `${base}/analytics/classes?month=2091-03` },
    { name: "analytics/summary", handler: summaryRoute, path: `${base}/analytics/summary?month=2091-03` },
    { name: "trend", handler: classTrendRoute, path: `${base}/analytics/classes/${classId}/trend`, params: { classId }, ownsId: true },
    { name: "student trend", handler: studentTrendRoute, path: `${base}/analytics/students/${student.id}`, params: { studentId: student.id }, ownsId: true },
    { name: "student month", handler: studentMonthRoute, path: `${base}/students/${student.id}/month?month=2091-03`, params: { studentId: student.id }, ownsId: true },
    { name: "detail", handler: detailRoute, path: `${base}/${row.id}`, params: { id: row.id }, ownsId: true },
  ];
});
after(disconnect);

const call = (endpoint: Endpoint, token: string | undefined, schoolId?: string) =>
  callRoute(endpoint.handler, { method: "GET", url: withSchool(endpoint.path, schoolId), bearer: token, params: endpoint.params });

async function expectAll(token: string | undefined, schoolId: string | undefined, status: number, code?: string): Promise<void> {
  for (const endpoint of endpoints) {
    const res = await call(endpoint, token, schoolId);
    assert.equal(res.status, status, `${endpoint.name}: ${JSON.stringify(res.body?.error)}`);
    if (code) assert.equal(res.body?.error?.code, code, endpoint.name);
  }
}

test("admin sekolah sendiri & super admin dengan schoolId -> 200 (respons sesuai kontrak)", async () => {
  await expectAll(a.adminToken, undefined, 200);
  await expectAll(a.adminToken, a.school.id, 200);
  await expectAll(superToken, a.school.id, 200);
});

test("tanpa token 401, siswa 403, admin dengan schoolId lain 403, super admin tanpa schoolId 400", async () => {
  await expectAll(undefined, undefined, 401, "UNAUTHENTICATED");
  await expectAll(studentToken, undefined, 403, "FORBIDDEN");
  await expectAll(a.adminToken, b.school.id, 403, "SCOPE_MISMATCH");
  await expectAll(superToken, undefined, 400, "SCHOOL_ID_REQUIRED");
  await expectAll(superToken, "sekolah-tidak-ada", 404, "SCHOOL_NOT_FOUND");
});

test("id milik sekolah lain -> 404 untuk admin sekolah lain & super admin yang menyebut sekolah lain", async () => {
  for (const endpoint of endpoints.filter((e) => e.ownsId)) {
    assert.equal((await call(endpoint, b.adminToken)).status, 404, `${endpoint.name} admin B`);
    assert.equal((await call(endpoint, superToken, b.school.id)).status, 404, `${endpoint.name} super admin -> B`);
  }
});

test("admin yang wajib ganti kata sandi ditolak 403 PASSWORD_CHANGE_REQUIRED", async () => {
  const admin = await createSchoolAdmin(a.school.id, { mustChangePassword: true });
  const res = await call(endpoints[0]!, await webToken(admin.id));
  assert.equal(res.status, 403);
  assert.equal(res.body?.error?.code, "PASSWORD_CHANGE_REQUIRED");
});
