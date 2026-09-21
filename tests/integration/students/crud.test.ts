import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { GET as getOne, PATCH as patchOne, DELETE as deleteOne } from "@/app/api/v1/school/students/[id]/route";
import { GET as list, POST as create } from "@/app/api/v1/school/students/route";
import { GET as profile } from "@/app/api/v1/student/profile/route";
import { verifyPassword } from "@/lib/auth/password";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { createSessionToken } from "../helpers/auth";
import { disconnect, prisma, uniq } from "../helpers/db";
import { createClass, createStudent, uniqNisn } from "../helpers/factories";
import { callRoute, type Envelope } from "../helpers/request";
import { completeStudentBody, countSchoolStudents, createSchoolFixture, studentUrl, type SchoolFixture } from "./helpers";

type Detail = {
  id: string;
  name: string;
  nisn: string;
  status: string;
  guardianPhone: string | null;
  sppAmount: number | null;
  hasActiveNisn: boolean;
  activatedAt: string | null;
  class: { id: string } | null;
  user: { isActive: boolean; mustChangePassword: boolean; tempPasswordExpiresAt: string | null };
  activationGaps: Array<{ field: string; code: string }>;
};
type CreateBody = Envelope<{ student: Detail; temporaryPassword: string; tempPasswordExpiresAt: string; nisnReleased: boolean }>;
type ListBody = Envelope<Array<{ id: string; name: string; nis: string; class: { id: string } | null }>>;

let a: SchoolFixture;

before(async () => {
  resetAllLimiters();
  a = await createSchoolFixture();
});
after(disconnect);

const post = (json: unknown, token = a.adminToken, url = studentUrl("")) => callRoute<CreateBody>(create, { method: "POST", url, json, bearer: token });

describe("POST /school/students", () => {
  test("activate=true (default) dengan data lengkap -> ACTIVE, akun aktif, wajib ganti password, kata sandi sementara", async () => {
    const body = completeStudentBody(a.klass.id);
    const res = await post(body);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const created = res.body?.data;
    assert.ok(created);
    assert.equal(created.student.status, "ACTIVE");
    assert.equal(created.student.hasActiveNisn, true);
    assert.equal(created.student.guardianPhone, "+6281234567890");
    assert.equal(created.student.user.isActive, true);
    assert.equal(created.student.user.mustChangePassword, true);
    assert.ok(created.student.activatedAt);
    assert.deepEqual(created.student.activationGaps, []);
    assert.equal(created.nisnReleased, false);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const expiresInDays = (Date.parse(created.tempPasswordExpiresAt) - Date.now()) / 86_400_000;
    assert.ok(expiresInDays > 13.9 && expiresInDays <= 14.01);
    const row = await prisma.student.findFirst({ where: { id: created.student.id, schoolId: a.school.id }, include: { user: { omit: { passwordHash: false } } } });
    assert.equal(row?.activeNisn, body.nisn);
    assert.equal(row?.user.email, null);
    assert.equal(await verifyPassword(created.temporaryPassword, row?.user.passwordHash ?? null), true);
    assert.ok(row?.user.passwordHash.startsWith("$2b$08$") || row?.user.passwordHash.startsWith("$2a$08$") || row?.user.passwordHash.startsWith("$2y$08$"));
    const audit = await prisma.auditLog.findFirst({ where: { action: "student.create", entityId: created.student.id } });
    assert.equal(audit?.schoolId, a.school.id);
    assert.doesNotMatch(JSON.stringify(audit?.after), new RegExp(created.temporaryPassword));
  });

  test("activate=true dengan data kurang -> 422 ACTIVATION_INCOMPLETE {gaps} dan TIDAK ada yang tertulis", async () => {
    const before = await countSchoolStudents(a.school.id);
    const res = await post(completeStudentBody(a.klass.id, { address: null, birthPlace: undefined }));
    assert.equal(res.status, 422);
    assert.equal(res.body?.error?.code, "ACTIVATION_INCOMPLETE");
    const gaps = (res.body?.error?.details as { gaps: Array<{ field: string }> }).gaps.map((g) => g.field);
    assert.deepEqual(gaps, ["birthPlace", "address"]);
    assert.deepEqual(await countSchoolStudents(a.school.id), before);
  });

  test("activate=false -> DRAFT, User.isActive=false, activeNisn NULL, kekurangan dilaporkan", async () => {
    const res = await post({ nisn: uniqNisn(), nis: uniq("D").slice(0, 20), name: "Draf Siswa", gender: "FEMALE", activate: false });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const student = res.body?.data.student;
    assert.equal(student?.status, "DRAFT");
    assert.equal(student?.hasActiveNisn, false);
    assert.equal(student?.user.isActive, false);
    assert.equal(student?.activatedAt, null);
    assert.ok((student?.activationGaps.length ?? 0) >= 6);
  });

  test("NISN / NIS ganda dalam sekolah -> 409", async () => {
    const body = completeStudentBody(a.klass.id);
    assert.equal((await post(body)).status, 201);
    const dupNisn = await post(completeStudentBody(a.klass.id, { nisn: body.nisn }));
    assert.equal(dupNisn.status, 409);
    assert.equal(dupNisn.body?.error?.code, "NISN_ALREADY_IN_SCHOOL");
    const dupNis = await post(completeStudentBody(a.klass.id, { nis: body.nis }));
    assert.equal(dupNis.status, 409);
    assert.equal(dupNis.body?.error?.code, "NIS_ALREADY_IN_SCHOOL");
  });

  test("kelas nonaktif -> 422 CLASS_INACTIVE; kelas tahun ajaran lain -> 422 gap", async () => {
    const inactive = await createClass(a.school.id, a.academicYearId, { isActive: false });
    const res = await post(completeStudentBody(inactive.id));
    assert.equal(res.status, 422);
    assert.equal(res.body?.error?.code, "CLASS_INACTIVE");
    const oldYear = await prisma.academicYear.create({
      data: { schoolId: a.school.id, name: "2020/2021", startDate: new Date("2020-07-13"), endDate: new Date("2021-06-26") },
    });
    const oldClass = await createClass(a.school.id, oldYear.id);
    const gap = await post(completeStudentBody(oldClass.id));
    assert.equal(gap.status, 422);
    assert.equal(gap.body?.error?.code, "ACTIVATION_INCOMPLETE");
    assert.match(JSON.stringify(gap.body?.error?.details), /CLASS_NOT_CURRENT_YEAR/);
  });

  test("validasi bentuk -> 400 (NISN salah, kunci asing, HP salah, tanggal salah)", async () => {
    for (const bad of [
      completeStudentBody(a.klass.id, { nisn: "123" }),
      completeStudentBody(a.klass.id, { nisn: "0000000000" }),
      completeStudentBody(a.klass.id, { initialPassword: "Rahasia123" }),
      completeStudentBody(a.klass.id, { guardianPhone: "021555" }),
      completeStudentBody(a.klass.id, { birthDate: "2012-02-30" }),
      completeStudentBody(a.klass.id, { sppAmount: 50_000_001 }),
      completeStudentBody(a.klass.id, { gender: "X" }),
    ]) {
      const res = await post(bad);
      assert.equal(res.status, 400, JSON.stringify(bad));
      assert.equal(res.body?.error?.code, "VALIDATION_FAILED");
    }
  });

  test("siswa tidak boleh membuat siswa -> 403", async () => {
    const { user } = await createStudent(a.school.id);
    const { token } = await createSessionToken(user.id);
    const res = await post(completeStudentBody(a.klass.id), token);
    assert.equal(res.status, 403);
  });
});

describe("GET /school/students", () => {
  const names = { percent: `Persen 100% ${uniq("x")}`, plain: `Persen 1000 ${uniq("y")}` };
  let digitsStudentId = "";

  before(async () => {
    const klass2 = await createClass(a.school.id, a.academicYearId, { name: uniq("VIII") });
    await createStudent(a.school.id, { name: names.percent, classId: a.klass.id });
    await createStudent(a.school.id, { name: names.plain, classId: klass2.id });
    const digits = await createStudent(a.school.id, { name: "Cari Angka", nis: `77${Date.now().toString().slice(-8)}`, nisn: `99${Date.now().toString().slice(-8)}` });
    digitsStudentId = digits.student.id;
    await createStudent(a.school.id, { name: "Siswa Lulus Tersembunyi", status: "GRADUATED" });
  });

  const get = (query: string) => callRoute<ListBody>(list, { method: "GET", url: `/api/v1/school/students?${query}`, bearer: a.adminToken });

  test("pencarian nama meloloskan wildcard LIKE (% tidak cocok ke semua)", async () => {
    const res = await get(`q=${encodeURIComponent("100%")}&limit=100`);
    assert.equal(res.status, 200);
    const found = res.body?.data.map((r) => r.name) ?? [];
    assert.ok(found.includes(names.percent));
    assert.ok(!found.includes(names.plain));
  });

  test("q digit mencocokkan awalan NIS dan awalan NISN", async () => {
    const row = await prisma.student.findFirst({ where: { id: digitsStudentId, schoolId: a.school.id } });
    const byNis = await get(`q=${row?.nis.slice(0, 6)}`);
    assert.ok(byNis.body?.data.some((r) => r.id === digitsStudentId));
    const byNisn = await get(`q=${row?.nisn.slice(0, 7)}`);
    assert.ok(byNisn.body?.data.some((r) => r.id === digitsStudentId));
  });

  test("default status tanpa LULUS; filter status & kelas; paginasi meta", async () => {
    const all = await get("limit=100&q=Siswa%20Lulus%20Tersembunyi");
    assert.equal(all.body?.data.length, 0);
    const graduated = await get("status=GRADUATED&q=Siswa%20Lulus%20Tersembunyi");
    assert.equal(graduated.body?.data.length, 1);
    const byClass = await get(`classId=${a.klass.id}&limit=100`);
    assert.ok(byClass.body?.data.every((r) => r.class?.id === a.klass.id));
    const page = await get("limit=1&page=1&sort=createdAt&order=desc");
    assert.equal(page.body?.data.length, 1);
    assert.ok(Number(page.body?.meta?.total ?? 0) >= 3);
  });

  test("query tidak valid -> 400 (status tak dikenal, q > 100, limit > 100)", async () => {
    assert.equal((await get("status=LULUS")).status, 400);
    assert.equal((await get(`q=${"a".repeat(101)}`)).status, 400);
    assert.equal((await get("limit=101")).status, 400);
  });
});

describe("GET/PATCH/DELETE /school/students/{id}", () => {
  const detailUrl = (id: string) => studentUrl(`/${id}`);

  test("detail memuat kekurangan aktivasi & info akun", async () => {
    const { student } = await createStudent(a.school.id, { status: "DRAFT", data: { address: null } });
    const res = await callRoute<{ data: Detail }>(getOne, { method: "GET", url: detailUrl(student.id), params: { id: student.id }, bearer: a.adminToken });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body?.data.activationGaps.map((g) => g.field), ["address", "currentClassId"]);
  });

  test("PATCH nama memperbarui User.name; SPP & HP dinormalisasi", async () => {
    const { student, user } = await createStudent(a.school.id, { classId: a.klass.id });
    const res = await callRoute<{ data: Detail }>(patchOne, {
      method: "PATCH", url: detailUrl(student.id), params: { id: student.id }, bearer: a.adminToken,
      json: { name: "  Nama   Baru  ", sppAmount: 0, guardianPhone: "+62 811 1111 2222" },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body?.data.name, "Nama Baru");
    assert.equal(res.body?.data.sppAmount, 0);
    assert.equal(res.body?.data.guardianPhone, "+6281111112222");
    const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
    assert.equal(dbUser?.name, "Nama Baru");
    assert.ok(await prisma.auditLog.findFirst({ where: { action: "student.update", entityId: student.id } }));
  });

  test("PATCH siswa AKTIF yang mengosongkan data wajib -> 422", async () => {
    const { student } = await createStudent(a.school.id, { classId: a.klass.id });
    const res = await callRoute(patchOne, { method: "PATCH", url: detailUrl(student.id), params: { id: student.id }, bearer: a.adminToken, json: { guardianPhone: null } });
    assert.equal(res.status, 422);
    assert.equal(res.body?.error?.code, "ACTIVATION_INCOMPLETE");
  });

  test("PATCH kelas: nonaktif -> 422 CLASS_INACTIVE; siswa AKTIF ke kelas tahun lalu -> 422; DRAFT boleh", async () => {
    const inactive = await createClass(a.school.id, a.academicYearId, { isActive: false });
    const oldYear = await prisma.academicYear.create({
      data: { schoolId: a.school.id, name: "2019/2020", startDate: new Date("2019-07-15"), endDate: new Date("2020-06-27") },
    });
    const oldClass = await createClass(a.school.id, oldYear.id);
    const active = await createStudent(a.school.id, { classId: a.klass.id });
    const patch = (id: string, json: unknown) => callRoute(patchOne, { method: "PATCH", url: detailUrl(id), params: { id }, bearer: a.adminToken, json });
    const toInactive = await patch(active.student.id, { currentClassId: inactive.id });
    assert.equal(toInactive.status, 422);
    assert.equal(toInactive.body?.error?.code, "CLASS_INACTIVE");
    const toOld = await patch(active.student.id, { currentClassId: oldClass.id });
    assert.equal(toOld.status, 422);
    assert.match(JSON.stringify(toOld.body?.error?.details), /CLASS_NOT_CURRENT_YEAR/);
    const draft = await createStudent(a.school.id, { status: "DRAFT" });
    assert.equal((await patch(draft.student.id, { currentClassId: oldClass.id })).status, 200);
    const klass2 = await createClass(a.school.id, a.academicYearId);
    const moved = await patch(active.student.id, { currentClassId: klass2.id });
    assert.equal(moved.status, 200);
    assert.equal((moved.body?.data as Detail).class?.id, klass2.id);
  });

  test("PATCH NISN oleh admin sekolah: DRAFT boleh, AKTIF -> 409 NISN_LOCKED", async () => {
    const draft = await createStudent(a.school.id, { status: "DRAFT" });
    const nisn = uniqNisn();
    const ok = await callRoute<{ data: Detail }>(patchOne, { method: "PATCH", url: detailUrl(draft.student.id), params: { id: draft.student.id }, bearer: a.adminToken, json: { nisn } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body?.data.nisn, nisn);
    const active = await createStudent(a.school.id, { classId: a.klass.id });
    const locked = await callRoute(patchOne, { method: "PATCH", url: detailUrl(active.student.id), params: { id: active.student.id }, bearer: a.adminToken, json: { nisn: uniqNisn() } });
    assert.equal(locked.status, 409);
    assert.equal(locked.body?.error?.code, "NISN_LOCKED");
  });

  test("PATCH kosong -> 400; kunci asing -> 400", async () => {
    const { student } = await createStudent(a.school.id, { classId: a.klass.id });
    assert.equal((await callRoute(patchOne, { method: "PATCH", url: detailUrl(student.id), params: { id: student.id }, bearer: a.adminToken, json: {} })).status, 400);
    assert.equal((await callRoute(patchOne, { method: "PATCH", url: detailUrl(student.id), params: { id: student.id }, bearer: a.adminToken, json: { status: "ACTIVE" } })).status, 400);
  });

  test("DELETE DRAFT menghapus Student + User; AKTIF -> 409 STUDENT_NOT_DRAFT; DRAFT terpakai -> 409 STUDENT_IN_USE", async () => {
    const draft = await createStudent(a.school.id, { status: "DRAFT" });
    const res = await callRoute(deleteOne, { method: "DELETE", url: detailUrl(draft.student.id), params: { id: draft.student.id }, bearer: a.adminToken });
    assert.equal(res.status, 200);
    assert.equal(await prisma.student.count({ where: { id: draft.student.id } }), 0);
    assert.equal(await prisma.user.count({ where: { id: draft.user.id } }), 0);
    const active = await createStudent(a.school.id);
    const notDraft = await callRoute(deleteOne, { method: "DELETE", url: detailUrl(active.student.id), params: { id: active.student.id }, bearer: a.adminToken });
    assert.equal(notDraft.status, 409);
    assert.equal(notDraft.body?.error?.code, "STUDENT_NOT_DRAFT");
    const used = await createStudent(a.school.id, { status: "DRAFT" });
    await prisma.checkInRejection.create({ data: { schoolId: a.school.id, studentId: used.student.id, date: new Date("2026-09-21"), reason: "OUTSIDE_GEOFENCE" } });
    const inUse = await callRoute(deleteOne, { method: "DELETE", url: detailUrl(used.student.id), params: { id: used.student.id }, bearer: a.adminToken });
    assert.equal(inUse.status, 409);
    assert.equal(inUse.body?.error?.code, "STUDENT_IN_USE");
  });
});

describe("GET /student/profile", () => {
  test("siswa AKTIF & LULUS membaca biodata sendiri; admin -> 403", async () => {
    for (const status of ["ACTIVE", "GRADUATED"] as const) {
      const { user, student } = await createStudent(a.school.id, { status, classId: a.klass.id, name: `Profil ${status}` });
      const { token } = await createSessionToken(user.id);
      const res = await callRoute<{ data: { name: string; nisn: string; className: string | null; school: { name: string }; status: string } }>(profile, {
        method: "GET", url: "/api/v1/student/profile", bearer: token,
      });
      assert.equal(res.status, 200);
      assert.equal(res.body?.data.nisn, student.nisn);
      assert.equal(res.body?.data.className, a.klass.name);
      assert.equal(res.body?.data.school.name, a.school.name);
      assert.equal(res.body?.data.status, status);
    }
    const adminRes = await callRoute(profile, { method: "GET", url: "/api/v1/student/profile", bearer: a.adminToken });
    assert.equal(adminRes.status, 403);
  });
});
