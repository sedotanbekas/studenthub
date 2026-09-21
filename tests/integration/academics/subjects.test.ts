import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { GET as listSubjectsRoute, POST as createSubjectRoute } from "@/app/api/v1/school/subjects/route";
import { DELETE as deleteSubjectRoute, PATCH as patchSubjectRoute } from "@/app/api/v1/school/subjects/[id]/route";
import { disconnect, prisma } from "../helpers/db";
import { createAcademicYearWithTerm, createClass, createStudent } from "../helpers/factories";
import { callRoute, type Envelope } from "../helpers/request";
import { createTenant, findAudit, setupTenants, withSchool, type Tenant, type TwoTenants } from "./helpers";

interface Subject {
  id: string;
  code: string;
  name: string;
  kkm: number;
  sortOrder: number;
  isActive: boolean;
}

const BASE = "/api/v1/school/subjects";
const MTK = { code: " mtk ", name: "Matematika", kkm: 75 };

let env: TwoTenants;
before(async () => {
  env = await setupTenants();
});
after(disconnect);

const listSubjects = (token: string, query = "") => callRoute<Envelope<Subject[]>>(listSubjectsRoute, { method: "GET", url: `${BASE}${query}`, bearer: token });
const postSubject = (body: unknown, token: string, schoolId?: string) =>
  callRoute<Envelope<Subject>>(createSubjectRoute, { method: "POST", url: withSchool(BASE, schoolId), bearer: token, json: body });
const patchSubject = (id: string, body: unknown, token: string, schoolId?: string) =>
  callRoute<Envelope<Subject>>(patchSubjectRoute, { method: "PATCH", url: withSchool(`${BASE}/${id}`, schoolId), bearer: token, json: body, params: { id } });
const deleteSubject = (id: string, token: string) =>
  callRoute<Envelope<{ id: string }>>(deleteSubjectRoute, { method: "DELETE", url: `${BASE}/${id}`, bearer: token, params: { id } });

async function created(t: Tenant, body: unknown = MTK): Promise<Subject> {
  const res = await postSubject(body, t.adminToken);
  assert.equal(res.status, 201, JSON.stringify(res.body?.error));
  return res.body!.data;
}

/** Nilai rapor DRAFT untuk mapel (membuat kelas, siswa, rapor pada semester aktif). */
async function gradeSubject(t: Tenant, subjectId: string): Promise<void> {
  const { academicYear, term } = await createAcademicYearWithTerm(t.schoolId);
  const cls = await createClass(t.schoolId, academicYear.id);
  const { student } = await createStudent(t.schoolId, { classId: cls.id });
  const card = await prisma.reportCard.create({ data: { schoolId: t.schoolId, studentId: student.id, termId: term.id, classId: cls.id, classNameSnapshot: cls.name } });
  await prisma.reportCardGrade.create({ data: { reportCardId: card.id, subjectId, subjectNameSnapshot: "Matematika", kkmSnapshot: 75, score: 90, predicate: "B" } });
}

test("buat mapel -> 201 (kode huruf besar, sortOrder default 0) + audit; kode ganda -> 409", async () => {
  const t = await createTenant();
  const s = await created(t);
  assert.deepEqual({ ...s, id: "x" }, { id: "x", code: "MTK", name: "Matematika", kkm: 75, sortOrder: 0, isActive: true });
  assert.ok(await findAudit(s.id, "subject.create"));
  const dup = await postSubject({ ...MTK, code: "Mtk" }, t.adminToken);
  assert.equal(dup.status, 409);
  assert.equal(dup.body?.error?.code, "SUBJECT_CODE_TAKEN");
  assert.equal((await postSubject(MTK, env.b.adminToken)).status, 201, "kode unik per sekolah, bukan global");
});

test("validasi mapel -> 400", async () => {
  const t = await createTenant();
  for (const body of [
    { ...MTK, code: "-MTK" },
    { ...MTK, code: "M".repeat(21) },
    { ...MTK, code: "MT K" },
    { ...MTK, name: "A" },
    { ...MTK, kkm: 101 },
    { ...MTK, kkm: 70.5 },
    { code: "MTK", name: "Matematika" },
    { ...MTK, sortOrder: 1000 },
    { ...MTK, schoolId: env.b.schoolId },
  ]) {
    assert.equal((await postSubject(body, t.adminToken)).status, 400, JSON.stringify(body));
  }
});

test("GET mapel: urut sortOrder lalu kode, filter isActive", async () => {
  const t = await createTenant();
  const b = await created(t, { code: "BIN", name: "Bahasa Indonesia", kkm: 70, sortOrder: 2 });
  const a = await created(t, { code: "AGM", name: "Agama", kkm: 75, sortOrder: 1 });
  const c = await created(t, { code: "ZZZ", name: "Lainnya", kkm: 60, sortOrder: 2 });
  await prisma.subject.update({ where: { id: c.id }, data: { isActive: false } });
  assert.deepEqual((await listSubjects(t.adminToken)).body?.data.map((s) => s.code), ["AGM", "BIN", "ZZZ"]);
  assert.deepEqual((await listSubjects(t.adminToken, "?isActive=true")).body?.data.map((s) => s.id), [a.id, b.id]);
  assert.deepEqual((await listSubjects(t.adminToken, "?isActive=false")).body?.data.map((s) => s.id), [c.id]);
});

test("PATCH mapel: kode terkunci setelah dinilai; field lain tetap bisa diubah", async () => {
  const t = await createTenant();
  const s = await created(t);
  const renamed = await patchSubject(s.id, { code: "mat", sortOrder: 5 }, t.adminToken);
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body?.data.code, "MAT");
  await created(t, { code: "IPA", name: "IPA", kkm: 70 });
  assert.equal((await patchSubject(s.id, { code: "IPA" }, t.adminToken)).body?.error?.code, "SUBJECT_CODE_TAKEN");
  await gradeSubject(t, s.id);
  const locked = await patchSubject(s.id, { code: "MTK2" }, t.adminToken);
  assert.equal(locked.status, 409);
  assert.equal(locked.body?.error?.code, "SUBJECT_CODE_LOCKED");
  const kkm = await patchSubject(s.id, { kkm: 80, name: "Matematika Wajib" }, t.adminToken);
  assert.equal(kkm.status, 200);
  assert.deepEqual([kkm.body?.data.kkm, kkm.body?.data.name], [80, "Matematika Wajib"]);
  assert.ok(await findAudit(s.id, "subject.update"));
  assert.equal((await patchSubject(s.id, {}, t.adminToken)).status, 400);
});

test("nonaktif mapel ditolak selama terpetakan ke kelas aktif tahun ajaran aktif", async () => {
  const t = await createTenant();
  const s = await created(t);
  const { academicYear } = await createAcademicYearWithTerm(t.schoolId);
  const cls = await createClass(t.schoolId, academicYear.id);
  await prisma.classSubject.create({ data: { classId: cls.id, subjectId: s.id } });
  const blocked = await patchSubject(s.id, { isActive: false }, t.adminToken);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body?.error?.code, "SUBJECT_MAPPED");
  await prisma.schoolClass.update({ where: { id: cls.id }, data: { isActive: false } });
  const ok = await patchSubject(s.id, { isActive: false }, t.adminToken);
  assert.equal(ok.status, 200);
  assert.equal(ok.body?.data.isActive, false);
});

test("DELETE mapel hanya bila tidak dipetakan dan belum dinilai", async () => {
  const t = await createTenant();
  const mapped = await created(t);
  const { academicYear } = await createAcademicYearWithTerm(t.schoolId, { active: false });
  const cls = await createClass(t.schoolId, academicYear.id);
  await prisma.classSubject.create({ data: { classId: cls.id, subjectId: mapped.id } });
  const blocked = await deleteSubject(mapped.id, t.adminToken);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body?.error?.code, "SUBJECT_IN_USE");
  const free = await created(t, { code: "SENI", name: "Seni Budaya", kkm: 70 });
  const res = await deleteSubject(free.id, t.adminToken);
  assert.equal(res.status, 200);
  assert.equal(await prisma.subject.count({ where: { id: free.id } }), 0);
  assert.ok(await findAudit(free.id, "subject.delete"));
});

test("peran salah -> 403", async () => {
  assert.equal((await listSubjects(env.studentToken)).status, 403);
  assert.equal((await postSubject(MTK, env.studentToken)).status, 403);
});

test("IDOR dua sekolah pada mapel", async () => {
  const s = await created(env.a, { code: "IDOR1", name: "Mapel A", kkm: 70 });
  assert.equal((await patchSubject(s.id, { kkm: 60 }, env.b.adminToken)).status, 404);
  assert.equal((await deleteSubject(s.id, env.b.adminToken)).status, 404);
  assert.equal((await listSubjects(env.b.adminToken)).body?.data.some((x) => x.id === s.id), false);
  assert.equal((await postSubject(MTK, env.a.adminToken, env.b.schoolId)).body?.error?.code, "SCOPE_MISMATCH");
  assert.equal((await listSubjects(env.superToken)).body?.error?.code, "SCHOOL_ID_REQUIRED");
  assert.equal((await patchSubject(s.id, { kkm: 60 }, env.superToken, env.b.schoolId)).status, 404);
  assert.equal((await patchSubject(s.id, { kkm: 60 }, env.superToken, env.a.schoolId)).status, 200);
});
