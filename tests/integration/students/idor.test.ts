import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { POST as activate } from "@/app/api/v1/school/students/[id]/activate/route";
import { POST as resetPassword } from "@/app/api/v1/school/students/[id]/reset-password/route";
import { DELETE as deleteOne, GET as getOne, PATCH as patchOne } from "@/app/api/v1/school/students/[id]/route";
import { POST as changeStatus } from "@/app/api/v1/school/students/[id]/status/route";
import { POST as importRoute } from "@/app/api/v1/school/students/import/route";
import { GET as template } from "@/app/api/v1/school/students/import/template/route";
import { GET as list, POST as create } from "@/app/api/v1/school/students/route";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { createSessionToken } from "../helpers/auth";
import { disconnect, prisma } from "../helpers/db";
import { createSponsor, createStudent, type TestStudent } from "../helpers/factories";
import { callRoute, type AnyRouteHandler, type HttpMethod } from "../helpers/request";
import {
  IMPORT_HEADER,
  callMultipart,
  completeStudentBody,
  createSchoolFixture,
  createSuperAdminToken,
  csvBlob,
  importForm,
  importRow,
  studentUrl,
  type SchoolFixture,
} from "./helpers";

let a: SchoolFixture;
let b: SchoolFixture;
let superToken = "";
let bActive: TestStudent;
let bDraft: TestStudent;

before(async () => {
  [a, b] = await Promise.all([createSchoolFixture(), createSchoolFixture()]);
  superToken = (await createSuperAdminToken()).token;
  bActive = await createStudent(b.school.id, { classId: b.klass.id });
  bDraft = await createStudent(b.school.id, { status: "DRAFT", classId: b.klass.id });
});
beforeEach(() => resetAllLimiters());
after(disconnect);

interface ByIdCall {
  readonly name: string;
  readonly handler: AnyRouteHandler;
  readonly method: HttpMethod;
  readonly suffix: string;
  readonly json?: unknown;
}

const BY_ID: readonly ByIdCall[] = [
  { name: "GET detail", handler: getOne, method: "GET", suffix: "" },
  { name: "PATCH", handler: patchOne, method: "PATCH", suffix: "", json: { address: "Jl. Diretas No. 1, Kota" } },
  { name: "DELETE", handler: deleteOne, method: "DELETE", suffix: "" },
  { name: "activate", handler: activate, method: "POST", suffix: "/activate", json: {} },
  { name: "status", handler: changeStatus, method: "POST", suffix: "/status", json: { to: "INACTIVE", reason: "uji IDOR" } },
  { name: "reset-password", handler: resetPassword, method: "POST", suffix: "/reset-password" },
];

const callById = (c: ByIdCall, id: string, token: string, schoolId?: string) =>
  callRoute(c.handler, { method: c.method, url: studentUrl(`/${id}${c.suffix}`, schoolId), params: { id }, bearer: token, json: c.json });

describe("IDOR dua sekolah", () => {
  test("admin sekolah A atas siswa sekolah B -> 404 di semua endpoint by-id, data B tidak berubah", async () => {
    for (const c of BY_ID) {
      const target = c.name === "DELETE" || c.name === "activate" ? bDraft : bActive;
      const res = await callById(c, target.student.id, a.adminToken);
      assert.equal(res.status, 404, `${c.name}: ${JSON.stringify(res.body)}`);
    }
    const untouched = await prisma.student.findFirst({ where: { id: bActive.student.id, schoolId: b.school.id } });
    assert.equal(untouched?.status, "ACTIVE");
    assert.equal(untouched?.address, bActive.student.address);
    assert.ok(await prisma.student.findFirst({ where: { id: bDraft.student.id, schoolId: b.school.id } }));
  });

  test("admin sekolah A mengirim schoolId sekolah B -> 403 SCOPE_MISMATCH", async () => {
    const res = await callRoute(list, { method: "GET", url: studentUrl("", b.school.id), bearer: a.adminToken });
    assert.equal(res.status, 403);
    assert.equal(res.body?.error?.code, "SCOPE_MISMATCH");
    const byId = await callById(BY_ID[0] as ByIdCall, bActive.student.id, a.adminToken, b.school.id);
    assert.equal(byId.status, 403);
    const tpl = await callRoute(template, { method: "GET", url: `/api/v1/school/students/import/template?schoolId=${b.school.id}`, bearer: a.adminToken });
    assert.equal(tpl.status, 403);
  });

  test("daftar admin A tidak pernah memuat siswa B", async () => {
    const res = await callRoute<{ data: Array<{ id: string }> }>(list, { method: "GET", url: `/api/v1/school/students?q=${bActive.student.nisn}`, bearer: a.adminToken });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body?.data, []);
  });

  test("membuat / memindah siswa ke kelas sekolah B -> 404 CLASS_NOT_FOUND", async () => {
    const created = await callRoute(create, { method: "POST", url: studentUrl(""), bearer: a.adminToken, json: completeStudentBody(b.klass.id) });
    assert.equal(created.status, 404);
    assert.equal(created.body?.error?.code, "CLASS_NOT_FOUND");
    const own = await createStudent(a.school.id, { classId: a.klass.id });
    const moved = await callRoute(patchOne, {
      method: "PATCH", url: studentUrl(`/${own.student.id}`), params: { id: own.student.id }, bearer: a.adminToken, json: { currentClassId: b.klass.id },
    });
    assert.equal(moved.status, 404);
    assert.equal(moved.body?.error?.code, "CLASS_NOT_FOUND");
  });

  test("id kelas tak dikenal (hingga 191 karakter) -> 404 CLASS_NOT_FOUND, bukan 500, tanpa baris AppLock baru", async () => {
    const own = await createStudent(a.school.id, { classId: a.klass.id });
    for (const classId of ["k".repeat(191), `tak-ada-${Date.now()}`]) {
      const patch = await callRoute(patchOne, {
        method: "PATCH", url: studentUrl(`/${own.student.id}`), params: { id: own.student.id }, bearer: a.adminToken, json: { currentClassId: classId },
      });
      assert.equal(patch.status, 404, JSON.stringify(patch.body));
      assert.equal(patch.body?.error?.code, "CLASS_NOT_FOUND");
      const created = await callRoute(create, { method: "POST", url: studentUrl(""), bearer: a.adminToken, json: completeStudentBody(classId) });
      assert.equal(created.status, 404, JSON.stringify(created.body));
      assert.equal(await prisma.appLock.count({ where: { key: `class:${classId}` } }), 0);
    }
    const bogusSchool = "s".repeat(191);
    const bySuper = await callRoute(patchOne, {
      method: "PATCH", url: studentUrl(`/${own.student.id}`, bogusSchool), params: { id: own.student.id }, bearer: superToken, json: { nisn: "0099887766" },
    });
    assert.equal(bySuper.status, 404, JSON.stringify(bySuper.body));
    assert.equal(await prisma.appLock.count({ where: { key: { startsWith: "nisn-release:sss" } } }), 0);
  });

  test("impor dengan nama kelas sekolah B tidak cocok (kelas hanya dari sekolah sendiri)", async () => {
    const res = await callMultipart<{ data: { report: { errorRows: number } } }>(importRoute, {
      url: "/api/v1/school/students/import", form: importForm(csvBlob([IMPORT_HEADER, importRow(b.klass.name)]), "x.csv"), bearer: a.adminToken,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body?.data.report.errorRows, 1);
  });
});

describe("super admin", () => {
  test("tanpa schoolId -> 400 SCHOOL_ID_REQUIRED di semua endpoint /school/students*", async () => {
    const calls = [
      callRoute(list, { method: "GET", url: studentUrl(""), bearer: superToken }),
      callRoute(create, { method: "POST", url: studentUrl(""), bearer: superToken, json: completeStudentBody(b.klass.id) }),
      callRoute(template, { method: "GET", url: "/api/v1/school/students/import/template", bearer: superToken }),
      callMultipart(importRoute, { url: "/api/v1/school/students/import", form: importForm(csvBlob([IMPORT_HEADER]), "x.csv"), bearer: superToken }),
      ...BY_ID.map((c) => callById(c, bActive.student.id, superToken)),
    ];
    for (const res of await Promise.all(calls)) {
      assert.equal(res.status, 400, JSON.stringify(res.body));
      assert.equal(res.body?.error?.code, "SCHOOL_ID_REQUIRED");
    }
  });

  test("dengan schoolId sekolah B -> boleh; schoolId A untuk siswa B -> 404; sekolah tak dikenal -> 404", async () => {
    const ok = await callById(BY_ID[0] as ByIdCall, bActive.student.id, superToken, b.school.id);
    assert.equal(ok.status, 200);
    const wrongScope = await callById(BY_ID[0] as ByIdCall, bActive.student.id, superToken, a.school.id);
    assert.equal(wrongScope.status, 404);
    const unknown = await callRoute(list, { method: "GET", url: studentUrl("", "sekolah-tidak-ada"), bearer: superToken });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body?.error?.code, "SCHOOL_NOT_FOUND");
    const created = await callRoute(create, { method: "POST", url: studentUrl("", b.school.id), bearer: superToken, json: completeStudentBody(b.klass.id) });
    assert.equal(created.status, 201, JSON.stringify(created.body));
  });
});

describe("gerbang peran", () => {
  test("sponsor & siswa -> 403 pada endpoint admin siswa", async () => {
    const { user: sponsorUser } = await createSponsor();
    const sponsorToken = (await createSessionToken(sponsorUser.id, { platform: "WEB", deviceId: null })).token;
    const { user: studentUser } = await createStudent(a.school.id);
    const studentToken = (await createSessionToken(studentUser.id)).token;
    for (const token of [sponsorToken, studentToken]) {
      assert.equal((await callRoute(list, { method: "GET", url: studentUrl(""), bearer: token })).status, 403);
      assert.equal((await callById(BY_ID[0] as ByIdCall, bActive.student.id, token)).status, 403);
      assert.equal((await callById(BY_ID[5] as ByIdCall, bActive.student.id, token)).status, 403);
    }
  });

  test("tanpa token -> 401", async () => {
    assert.equal((await callRoute(list, { method: "GET", url: studentUrl("") })).status, 401);
  });
});
