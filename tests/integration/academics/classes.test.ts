import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { GET as listClassesRoute, POST as createClassRoute } from "@/app/api/v1/school/classes/route";
import { DELETE as deleteClassRoute, PATCH as patchClassRoute } from "@/app/api/v1/school/classes/[id]/route";
import { GET as getSubjectsRoute, PUT as putSubjectsRoute } from "@/app/api/v1/school/classes/[id]/subjects/route";
import { classLockKey, classYearLockKey } from "@/lib/lock-keys";
import { disconnect, prisma, uniq } from "../helpers/db";
import { createAcademicYearWithTerm, createClass, createStudent } from "../helpers/factories";
import { callRoute, type Envelope } from "../helpers/request";
import { createTenant, findAudit, holdLock, raceWhileHeld, setupTenants, withSchool, type Tenant, type TwoTenants } from "./helpers";

interface ClassItem {
  id: string;
  academicYearId: string;
  academicYearName: string;
  name: string;
  gradeLevel: number;
  isActive: boolean;
  activeStudentCount: number;
  subjectCount: number;
}
interface ClassSubjects {
  classId: string;
  subjects: Array<{ subjectId: string; code: string; sortOrder: number; isActive: boolean }>;
  orphanGradeCount?: number;
}

const BASE = "/api/v1/school/classes";

let env: TwoTenants;
before(async () => {
  env = await setupTenants();
});
after(disconnect);

const listClasses = (token: string, query = "") =>
  callRoute<Envelope<ClassItem[]>>(listClassesRoute, { method: "GET", url: `${BASE}${query}`, bearer: token });
const postClass = (body: unknown, token: string, schoolId?: string) =>
  callRoute<Envelope<ClassItem>>(createClassRoute, { method: "POST", url: withSchool(BASE, schoolId), bearer: token, json: body });
const patchClass = (id: string, body: unknown, token: string, schoolId?: string) =>
  callRoute<Envelope<ClassItem>>(patchClassRoute, { method: "PATCH", url: withSchool(`${BASE}/${id}`, schoolId), bearer: token, json: body, params: { id } });
const deleteClass = (id: string, token: string) =>
  callRoute<Envelope<{ id: string }>>(deleteClassRoute, { method: "DELETE", url: `${BASE}/${id}`, bearer: token, params: { id } });
const getSubjects = (id: string, token: string, schoolId?: string) =>
  callRoute<Envelope<ClassSubjects>>(getSubjectsRoute, { method: "GET", url: withSchool(`${BASE}/${id}/subjects`, schoolId), bearer: token, params: { id } });
const putSubjects = (id: string, subjectIds: unknown, token: string) =>
  callRoute<Envelope<ClassSubjects>>(putSubjectsRoute, { method: "PUT", url: `${BASE}/${id}/subjects`, bearer: token, json: { subjectIds }, params: { id } });

function subject(schoolId: string, isActive = true) {
  return prisma.subject.create({ data: { schoolId, code: uniq("S").slice(0, 20).toUpperCase(), name: "Mapel Uji", kkm: 75, isActive } });
}

async function tenantWithYears(): Promise<{ t: Tenant; yearId: string; oldYearId: string }> {
  const t = await createTenant();
  const old = await createAcademicYearWithTerm(t.schoolId, {
    name: "2025/2026", yearStart: "2025-07-14", yearEnd: "2026-06-27", termStart: "2025-07-14", termEnd: "2025-12-20", active: false,
  });
  const current = await createAcademicYearWithTerm(t.schoolId);
  return { t, yearId: current.academicYear.id, oldYearId: old.academicYear.id };
}

test("buat kelas -> 201 (nama dirapikan) + audit; nama ganda per tahun ajaran -> 409", async () => {
  const { t, yearId, oldYearId } = await tenantWithYears();
  const res = await postClass({ academicYearId: yearId, name: "  VII   A ", gradeLevel: 7 }, t.adminToken);
  assert.equal(res.status, 201, JSON.stringify(res.body?.error));
  assert.deepEqual(
    { ...res.body!.data, id: "x" },
    { id: "x", academicYearId: yearId, academicYearName: "2026/2027", name: "VII A", gradeLevel: 7, isActive: true, activeStudentCount: 0, subjectCount: 0 },
  );
  assert.ok(await findAudit(res.body!.data.id, "class.create"));
  const dup = await postClass({ academicYearId: yearId, name: "vii a", gradeLevel: 8 }, t.adminToken);
  assert.equal(dup.status, 409);
  assert.equal(dup.body?.error?.code, "CLASS_NAME_TAKEN");
  assert.equal((await postClass({ academicYearId: oldYearId, name: "VII A", gradeLevel: 7 }, t.adminToken)).status, 201);
});

test("validasi kelas -> 400; tahun ajaran sekolah lain -> 404", async () => {
  const { t, yearId } = await tenantWithYears();
  for (const body of [
    { academicYearId: yearId, name: "X", gradeLevel: 13 },
    { academicYearId: yearId, name: "X", gradeLevel: 1.5 },
    { academicYearId: yearId, name: "   ", gradeLevel: 7 },
    { academicYearId: yearId, name: "X".repeat(51), gradeLevel: 7 },
    { academicYearId: yearId, name: "X", gradeLevel: 7, schoolId: env.b.schoolId },
    { name: "X", gradeLevel: 7 },
  ]) {
    assert.equal((await postClass(body, t.adminToken)).status, 400, JSON.stringify(body));
  }
  const foreignYear = await createAcademicYearWithTerm(env.b.schoolId, {
    name: "2040/2041", yearStart: "2040-07-16", yearEnd: "2041-06-29", termStart: "2040-07-16", termEnd: "2040-12-21", active: false,
  });
  assert.equal((await postClass({ academicYearId: foreignYear.academicYear.id, name: "X", gradeLevel: 7 }, t.adminToken)).status, 404);
});

test("GET kelas: default tahun ajaran aktif, filter, dan jumlah siswa aktif", async () => {
  const { t, yearId, oldYearId } = await tenantWithYears();
  const a = await createClass(t.schoolId, yearId, { name: "VIII-B", gradeLevel: 8 });
  const b = await createClass(t.schoolId, yearId, { name: "VII-A", gradeLevel: 7, isActive: false });
  const old = await createClass(t.schoolId, oldYearId, { name: "VII-Z" });
  await createStudent(t.schoolId, { classId: a.id });
  await createStudent(t.schoolId, { classId: a.id, status: "INACTIVE" });
  const def = await listClasses(t.adminToken);
  assert.equal(def.status, 200);
  assert.deepEqual(def.body?.data.map((c) => [c.name, c.activeStudentCount]), [["VII-A", 0], ["VIII-B", 1]]);
  assert.deepEqual((await listClasses(t.adminToken, `?academicYearId=${oldYearId}`)).body?.data.map((c) => c.id), [old.id]);
  assert.deepEqual((await listClasses(t.adminToken, "?isActive=false")).body?.data.map((c) => c.id), [b.id]);
  assert.deepEqual((await listClasses(t.adminToken, "?gradeLevel=8")).body?.data.map((c) => c.id), [a.id]);
  assert.equal((await listClasses(t.adminToken, "?isActive=ya")).status, 400);
});

test("PATCH kelas: ubah nama, nonaktif ditolak selama ada siswa aktif", async () => {
  const { t, yearId } = await tenantWithYears();
  const cls = await createClass(t.schoolId, yearId, { name: "IX-A", gradeLevel: 9 });
  await createClass(t.schoolId, yearId, { name: "IX-B", gradeLevel: 9 });
  const { student } = await createStudent(t.schoolId, { classId: cls.id });
  const renamed = await patchClass(cls.id, { name: "IX-C", gradeLevel: 9 }, t.adminToken);
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body?.data.name, "IX-C");
  assert.equal((await patchClass(cls.id, { name: "IX-B" }, t.adminToken)).body?.error?.code, "CLASS_NAME_TAKEN");
  const blocked = await patchClass(cls.id, { isActive: false }, t.adminToken);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body?.error?.code, "CLASS_HAS_STUDENTS");
  await prisma.student.update({ where: { id: student.id }, data: { status: "INACTIVE" } });
  const off = await patchClass(cls.id, { isActive: false }, t.adminToken);
  assert.equal(off.status, 200);
  assert.equal(off.body?.data.isActive, false);
  assert.ok(await findAudit(cls.id, "class.update"));
  assert.equal((await patchClass(cls.id, {}, t.adminToken)).status, 400);
});

test("PATCH kelas paralel (nonaktif & ganti nama) -> keduanya tersimpan, audit before dari baris terbaru", async () => {
  const { t, yearId } = await tenantWithYears();
  const cls = await createClass(t.schoolId, yearId, { name: "X-A", gradeLevel: 10 });
  const held = await holdLock(classYearLockKey(yearId));
  const [off, renamed] = await raceWhileHeld(held, [
    () => patchClass(cls.id, { isActive: false }, t.adminToken),
    () => patchClass(cls.id, { name: "X-Z" }, t.adminToken),
  ]);
  assert.deepEqual([off?.status, renamed?.status], [200, 200], JSON.stringify([off?.body?.error, renamed?.body?.error]));
  const row = await prisma.schoolClass.findUniqueOrThrow({ where: { id: cls.id } });
  assert.deepEqual([row.isActive, row.name], [false, "X-Z"], "perubahan pertama tidak boleh tertimpa data basi");
  const audits = await prisma.auditLog.findMany({ where: { entityId: cls.id, action: "class.update" } });
  const renameAudit = audits.find((a) => (a.after as { name?: string } | null)?.name === "X-Z");
  assert.equal((renameAudit?.before as { isActive?: boolean } | null)?.isActive, false, "before diambil dari baris setelah kunci");
});

test("nonaktif kelas menunggu aktivasi siswa yang sedang berjalan (kunci class:<id>) -> 409 CLASS_HAS_STUDENTS", async () => {
  const { t, yearId } = await tenantWithYears();
  const cls = await createClass(t.schoolId, yearId);
  const { student } = await createStudent(t.schoolId, { classId: cls.id, status: "INACTIVE" });
  const held = await holdLock(classLockKey(cls.id), (tx) => tx.student.update({ where: { id: student.id }, data: { status: "ACTIVE" } }));
  const [res] = await raceWhileHeld(held, [() => patchClass(cls.id, { isActive: false }, t.adminToken)]);
  assert.equal(res?.status, 409);
  assert.equal(res?.body?.error?.code, "CLASS_HAS_STUDENTS");
  assert.equal((await prisma.schoolClass.findUniqueOrThrow({ where: { id: cls.id } })).isActive, true);
});

test("buat kelas paralel dengan nama sama -> satu 201 + satu 409 CLASS_NAME_TAKEN", async () => {
  const { t, yearId } = await tenantWithYears();
  const held = await holdLock(classYearLockKey(yearId));
  const body = { academicYearId: yearId, name: "XI-Paralel", gradeLevel: 11 };
  const results = await raceWhileHeld(held, [() => postClass(body, t.adminToken), () => postClass(body, t.adminToken)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal(results.find((r) => r.status === 409)?.body?.error?.code, "CLASS_NAME_TAKEN");
  assert.equal(await prisma.schoolClass.count({ where: { academicYearId: yearId, name: "XI-Paralel" } }), 1);
});

test("DELETE kelas: dirujuk siswa -> 409 CLASS_IN_USE; kosong -> 200 (pemetaan mapel ikut terhapus)", async () => {
  const { t, yearId } = await tenantWithYears();
  const used = await createClass(t.schoolId, yearId);
  await createStudent(t.schoolId, { classId: used.id, status: "DRAFT" });
  const blocked = await deleteClass(used.id, t.adminToken);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body?.error?.code, "CLASS_IN_USE");
  const empty = await createClass(t.schoolId, yearId);
  const s = await subject(t.schoolId);
  await prisma.classSubject.create({ data: { classId: empty.id, subjectId: s.id } });
  const res = await deleteClass(empty.id, t.adminToken);
  assert.equal(res.status, 200);
  assert.equal(await prisma.classSubject.count({ where: { classId: empty.id } }), 0);
  assert.ok(await findAudit(empty.id, "class.delete"));
});

test("pemetaan mapel kelas: urutan, mapel nonaktif, duplikat, dan orphanGradeCount", async () => {
  const { t, yearId } = await tenantWithYears();
  const cls = await createClass(t.schoolId, yearId);
  const [s1, s2, inactive] = [await subject(t.schoolId), await subject(t.schoolId), await subject(t.schoolId, false)];
  assert.deepEqual((await getSubjects(cls.id, t.adminToken)).body?.data, { classId: cls.id, subjects: [] });
  const set = await putSubjects(cls.id, [s2.id, s1.id], t.adminToken);
  assert.equal(set.status, 200, JSON.stringify(set.body?.error));
  assert.deepEqual(set.body?.data.subjects.map((s) => [s.subjectId, s.sortOrder]), [[s2.id, 0], [s1.id, 1]]);
  assert.equal(set.body?.data.orphanGradeCount, 0);
  assert.ok(await findAudit(cls.id, "class_subject.set"));
  assert.equal((await listClasses(t.adminToken)).body?.data.find((c) => c.id === cls.id)?.subjectCount, 2);
  const rejected = await putSubjects(cls.id, [s1.id, inactive.id], t.adminToken);
  assert.equal(rejected.status, 422);
  assert.equal(rejected.body?.error?.code, "SUBJECT_INACTIVE");
  assert.equal((await putSubjects(cls.id, [s1.id, s1.id], t.adminToken)).status, 400);
  const { student } = await createStudent(t.schoolId, { classId: cls.id });
  const card = await prisma.reportCard.create({ data: { schoolId: t.schoolId, studentId: student.id, termId: (await prisma.school.findUniqueOrThrow({ where: { id: t.schoolId } })).activeTermId!, classId: cls.id, classNameSnapshot: cls.name } });
  await prisma.reportCardGrade.create({ data: { reportCardId: card.id, subjectId: s1.id, subjectNameSnapshot: s1.name, kkmSnapshot: 75, score: 80, predicate: "C" } });
  const shrink = await putSubjects(cls.id, [s2.id], t.adminToken);
  assert.equal(shrink.body?.data.orphanGradeCount, 1);
  assert.deepEqual((await getSubjects(cls.id, t.adminToken)).body?.data.subjects.map((s) => s.subjectId), [s2.id]);
});

test("mapel nonaktif yang sudah terpetakan boleh dipertahankan saat PUT", async () => {
  const { t, yearId } = await tenantWithYears();
  const cls = await createClass(t.schoolId, yearId, { isActive: false });
  const s = await subject(t.schoolId);
  await putSubjects(cls.id, [s.id], t.adminToken);
  await prisma.subject.update({ where: { id: s.id }, data: { isActive: false } });
  const res = await putSubjects(cls.id, [s.id], t.adminToken);
  assert.equal(res.status, 200);
  assert.equal(res.body?.data.subjects[0]?.isActive, false);
});

test("peran salah -> 403", async () => {
  assert.equal((await listClasses(env.studentToken)).status, 403);
});

test("IDOR dua sekolah pada kelas & pemetaan mapel", async () => {
  const yearA = await createAcademicYearWithTerm(env.a.schoolId, {
    name: "2033/2034", yearStart: "2033-07-11", yearEnd: "2034-06-24", termStart: "2033-07-11", termEnd: "2033-12-17", active: false,
  });
  const clsA = await createClass(env.a.schoolId, yearA.academicYear.id);
  const subjectB = await subject(env.b.schoolId);
  const subjectA = await subject(env.a.schoolId);
  assert.equal((await patchClass(clsA.id, { name: "Z" }, env.b.adminToken)).status, 404);
  assert.equal((await deleteClass(clsA.id, env.b.adminToken)).status, 404);
  assert.equal((await getSubjects(clsA.id, env.b.adminToken)).status, 404);
  assert.equal((await putSubjects(clsA.id, [subjectA.id], env.b.adminToken)).status, 404);
  assert.equal((await putSubjects(clsA.id, [subjectB.id], env.a.adminToken)).status, 404, "mapel sekolah lain");
  assert.equal((await getSubjects(clsA.id, env.a.adminToken, env.b.schoolId)).body?.error?.code, "SCOPE_MISMATCH");
  assert.equal((await getSubjects(clsA.id, env.superToken)).body?.error?.code, "SCHOOL_ID_REQUIRED");
  assert.equal((await getSubjects(clsA.id, env.superToken, env.b.schoolId)).status, 404);
  assert.equal((await getSubjects(clsA.id, env.superToken, env.a.schoolId)).status, 200);
  assert.equal((await patchClass(clsA.id, { gradeLevel: 8 }, env.superToken, env.a.schoolId)).status, 200);
  assert.equal((await postClass({ academicYearId: yearA.academicYear.id, name: "Z", gradeLevel: 7 }, env.b.adminToken)).status, 404);
});
