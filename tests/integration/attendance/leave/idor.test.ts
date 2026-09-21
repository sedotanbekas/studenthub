/**
 * IDOR dua sekolah untuk izin/sakit: id sekolah lain -> 404 (data tidak berubah), admin sekolah dengan
 * schoolId lain -> 403 SCOPE_MISMATCH, super admin tanpa schoolId -> 400, dengan schoolId -> berhasil,
 * siswa hanya melihat pengajuan miliknya.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { POST as approveRoute } from "@/app/api/v1/school/leave-requests/[id]/approve/route";
import { POST as rejectRoute } from "@/app/api/v1/school/leave-requests/[id]/reject/route";
import { GET as detailRoute } from "@/app/api/v1/school/leave-requests/[id]/route";
import { GET as listRoute, POST as onBehalfRoute } from "@/app/api/v1/school/leave-requests/route";
import { POST as cancelRoute } from "@/app/api/v1/student/leave-requests/[id]/cancel/route";
import { GET as ownDetail } from "@/app/api/v1/student/leave-requests/[id]/route";
import { POST as createOwn } from "@/app/api/v1/student/leave-requests/route";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { disconnect, prisma } from "../../helpers/db";
import { callRoute, type AnyRouteHandler, type Envelope, type HttpMethod } from "../../helpers/request";
import {
  callMultipart,
  createLeaveSchool,
  createStudentWithToken,
  freeRun,
  leaveForm,
  leaveUrl,
  superAdminToken,
  useInlineDefer,
  type LeaveSchoolFixture,
  type StudentWithToken,
} from "./helpers";

let restoreDefer: () => void = () => undefined;
let a: LeaveSchoolFixture;
let b: LeaveSchoolFixture;
let superToken = "";
let aStudent: StudentWithToken;
let bStudent: StudentWithToken;
let bLeaveId = "";

before(async () => {
  restoreDefer = useInlineDefer();
  [a, b] = [await createLeaveSchool(), await createLeaveSchool()];
  superToken = await superAdminToken();
  aStudent = await createStudentWithToken(a);
  bStudent = await createStudentWithToken(b);
  const res = await callMultipart<Envelope<{ id: string }>>(createOwn, {
    url: "/api/v1/student/leave-requests", form: leaveForm(await freeRun(3, 2)), bearer: bStudent.token,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  bLeaveId = res.body?.data.id ?? "";
});
beforeEach(() => resetAllLimiters());
after(async () => {
  restoreDefer();
  await disconnect();
});

interface ByIdCall {
  readonly name: string;
  readonly handler: AnyRouteHandler;
  readonly method: HttpMethod;
  readonly suffix: string;
  readonly json?: unknown;
}

const BY_ID: readonly ByIdCall[] = [
  { name: "detail", handler: detailRoute, method: "GET", suffix: "" },
  { name: "approve", handler: approveRoute, method: "POST", suffix: "/approve", json: {} },
  { name: "reject", handler: rejectRoute, method: "POST", suffix: "/reject", json: { note: "Uji IDOR tolak" } },
];

const callById = (c: ByIdCall, id: string, token: string, schoolId?: string) =>
  callRoute(c.handler, { method: c.method, url: leaveUrl(`/${id}${c.suffix}`, schoolId), params: { id }, json: c.json, bearer: token });

describe("IDOR dua sekolah", () => {
  test("admin A atas izin sekolah B -> 404 di semua endpoint by-id; izin B tetap PENDING & tanpa absensi", async () => {
    for (const c of BY_ID) {
      const res = await callById(c, bLeaveId, a.adminToken);
      assert.equal(res.status, 404, `${c.name}: ${JSON.stringify(res.body)}`);
    }
    const leave = await prisma.leaveRequest.findFirst({ where: { id: bLeaveId, schoolId: b.school.id } });
    assert.equal(leave?.status, "PENDING");
    assert.equal(leave?.reviewedById, null);
    assert.equal(await prisma.attendance.count({ where: { studentId: bStudent.student.id } }), 0);
  });

  test("admin A dengan ?schoolId=B -> 403 SCOPE_MISMATCH (daftar & by-id)", async () => {
    const list = await callRoute(listRoute, { method: "GET", url: leaveUrl("", b.school.id), bearer: a.adminToken });
    assert.equal(list.status, 403);
    assert.equal((list.body as Envelope | null)?.error?.code, "SCOPE_MISMATCH");
    const byId = await callById(BY_ID[0] as ByIdCall, bLeaveId, a.adminToken, b.school.id);
    assert.equal(byId.status, 403);
  });

  test("admin A mencatat izin untuk siswa sekolah B -> 404, tanpa baris", async () => {
    const res = await callMultipart(onBehalfRoute, { url: leaveUrl(""), form: leaveForm({ ...(await freeRun(6, 1)), studentId: bStudent.student.id }), bearer: a.adminToken });
    assert.equal(res.status, 404);
    assert.equal(await prisma.leaveRequest.count({ where: { studentId: bStudent.student.id, schoolId: a.school.id } }), 0);
  });

  test("daftar admin A tidak memuat izin sekolah B", async () => {
    const res = await callRoute<Envelope<Array<{ id: string }>>>(listRoute, { method: "GET", url: `${leaveUrl("")}?status=ALL&limit=100`, bearer: a.adminToken });
    assert.equal(res.status, 200);
    assert.equal(res.body?.data.some((l) => l.id === bLeaveId), false);
  });

  test("super admin: tanpa schoolId -> 400 SCHOOL_ID_REQUIRED; sekolah salah -> 404; dengan schoolId B -> 200", async () => {
    const noScope = await callRoute(listRoute, { method: "GET", url: leaveUrl(""), bearer: superToken });
    assert.equal(noScope.status, 400);
    assert.equal((noScope.body as Envelope | null)?.error?.code, "SCHOOL_ID_REQUIRED");
    const wrongSchool = await callById(BY_ID[0] as ByIdCall, bLeaveId, superToken, a.school.id);
    assert.equal(wrongSchool.status, 404);
    const unknownSchool = await callRoute(listRoute, { method: "GET", url: leaveUrl("", "sekolah-tidak-ada"), bearer: superToken });
    assert.equal(unknownSchool.status, 404);
    const detail = await callById(BY_ID[0] as ByIdCall, bLeaveId, superToken, b.school.id);
    assert.equal(detail.status, 200, JSON.stringify(detail.body));
  });

  test("siswa A tidak dapat melihat/membatalkan izin siswa B (404)", async () => {
    const detail = await callRoute(ownDetail, { method: "GET", url: `/api/v1/student/leave-requests/${bLeaveId}`, params: { id: bLeaveId }, bearer: aStudent.token });
    assert.equal(detail.status, 404);
    const cancel = await callRoute(cancelRoute, { method: "POST", url: `/api/v1/student/leave-requests/${bLeaveId}/cancel`, params: { id: bLeaveId }, bearer: aStudent.token });
    assert.equal(cancel.status, 404);
    assert.equal((await prisma.leaveRequest.findFirst({ where: { id: bLeaveId } }))?.status, "PENDING");
  });

  test("siswa tidak dapat memakai endpoint tinjau (403)", async () => {
    for (const c of BY_ID) {
      const res = await callById(c, bLeaveId, bStudent.token);
      assert.equal(res.status, 403, c.name);
    }
  });
});
