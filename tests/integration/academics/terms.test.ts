import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { POST as createTermRoute } from "@/app/api/v1/school/academic-years/[id]/terms/route";
import { DELETE as deleteTermRoute, PATCH as patchTermRoute } from "@/app/api/v1/school/terms/[id]/route";
import { GET as getActive, PUT as putActive } from "@/app/api/v1/school/active-term/route";
import { toDbDate } from "@/lib/time/zone";
import { disconnect, prisma } from "../helpers/db";
import { createAcademicYearWithTerm, createClass, createStudent } from "../helpers/factories";
import { callRoute, type Envelope } from "../helpers/request";
import { createTenant, findAudit, setupTenants, withSchool, type Tenant, type TwoTenants } from "./helpers";

interface Term {
  id: string;
  academicYearId: string;
  semester: string;
  label: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
}
interface ActiveTerm {
  term: Term | null;
  academicYear: { id: string; name: string } | null;
  activeStudentsOutsideYear?: number;
}

const GENAP = { semester: "GENAP", startDate: "2027-01-04", endDate: "2027-06-26" };

let env: TwoTenants;
before(async () => {
  env = await setupTenants();
});
after(disconnect);

function postTerm(yearId: string, body: unknown, token: string, schoolId?: string) {
  return callRoute<Envelope<Term>>(createTermRoute, {
    method: "POST", url: withSchool(`/api/v1/school/academic-years/${yearId}/terms`, schoolId), bearer: token, json: body, params: { id: yearId },
  });
}

function patchTerm(id: string, body: unknown, token: string, schoolId?: string) {
  return callRoute<Envelope<Term>>(patchTermRoute, { method: "PATCH", url: withSchool(`/api/v1/school/terms/${id}`, schoolId), bearer: token, json: body, params: { id } });
}

function deleteTerm(id: string, token: string) {
  return callRoute<Envelope<{ id: string }>>(deleteTermRoute, { method: "DELETE", url: `/api/v1/school/terms/${id}`, bearer: token, params: { id } });
}

function setActive(termId: unknown, token: string, schoolId?: string) {
  return callRoute<Envelope<ActiveTerm>>(putActive, { method: "PUT", url: withSchool("/api/v1/school/active-term", schoolId), bearer: token, json: { termId } });
}

async function alphaOn(t: Tenant, date: string): Promise<void> {
  const { student } = await createStudent(t.schoolId);
  await prisma.attendance.create({ data: { schoolId: t.schoolId, studentId: student.id, date: toDbDate(date), status: "ALPHA", source: "AUTO_ALPHA" } });
}

test("tambah semester Genap -> 201 dengan label turunan + audit", async () => {
  const t = await createTenant();
  const { academicYear } = await createAcademicYearWithTerm(t.schoolId, { active: false });
  const res = await postTerm(academicYear.id, GENAP, t.adminToken);
  assert.equal(res.status, 201, JSON.stringify(res.body?.error));
  assert.equal(res.body?.data.label, "Semester Genap 2026/2027");
  assert.equal(res.body?.data.isActive, false);
  assert.ok(await findAudit(res.body!.data.id, "term.create"));
});

test("semester: 400 bentuk, 409 duplikat, 422 aturan tanggal", async () => {
  const t = await createTenant();
  const { academicYear } = await createAcademicYearWithTerm(t.schoolId, { active: false });
  assert.equal((await postTerm(academicYear.id, { ...GENAP, semester: "KETIGA" }, t.adminToken)).status, 400);
  const dup = await postTerm(academicYear.id, { semester: "GANJIL", startDate: "2026-07-13", endDate: "2026-12-19" }, t.adminToken);
  assert.equal(dup.status, 409);
  assert.equal(dup.body?.error?.code, "TERM_SEMESTER_TAKEN");
  const cases: Array<[unknown, string]> = [
    [{ ...GENAP, startDate: "2026-12-19" }, "TERM_ORDER_INVALID"],
    [{ ...GENAP, endDate: "2027-06-27" }, "TERM_OUTSIDE_YEAR"],
    [{ ...GENAP, startDate: "2027-06-26", endDate: "2027-01-04" }, "INVALID_DATE_RANGE"],
  ];
  for (const [body, code] of cases) {
    const res = await postTerm(academicYear.id, body, t.adminToken);
    assert.equal(res.status, 422, code);
    assert.equal(res.body?.error?.code, code);
  }
  const bare = await prisma.academicYear.create({
    data: { schoolId: t.schoolId, name: "2027/2028", startDate: toDbDate("2027-07-12"), endDate: toDbDate("2028-06-24") },
  });
  const long = await postTerm(bare.id, { semester: "GANJIL", startDate: "2027-07-12", endDate: "2028-01-28" }, t.adminToken);
  assert.equal(long.body?.error?.code, "TERM_TOO_LONG");
});

test("PATCH semester; menyempit di atas data absensi -> 409 TERM_HAS_ATTENDANCE", async () => {
  const t = await createTenant();
  const { term } = await createAcademicYearWithTerm(t.schoolId, { active: false });
  const ok = await patchTerm(term.id, { endDate: "2026-12-18" }, t.adminToken);
  assert.equal(ok.status, 200);
  assert.equal(ok.body?.data.endDate, "2026-12-18");
  assert.ok(await findAudit(term.id, "term.update"));
  assert.equal((await patchTerm(term.id, { startDate: "2026-07-12" }, t.adminToken)).body?.error?.code, "TERM_OUTSIDE_YEAR");
  assert.equal((await patchTerm(term.id, { endDate: "2027-02-01" }, t.adminToken)).body?.error?.code, "TERM_TOO_LONG");
  await alphaOn(t, "2026-07-14");
  const shrink = await patchTerm(term.id, { startDate: "2026-07-20" }, t.adminToken);
  assert.equal(shrink.status, 409);
  assert.equal(shrink.body?.error?.code, "TERM_HAS_ATTENDANCE");
  assert.equal((await patchTerm(term.id, { startDate: "2026-07-14" }, t.adminToken)).status, 200, "tanggal absensi tetap tercakup");
});

test("DELETE semester: aktif -> 409, punya rapor -> 409, punya absensi -> 409, selain itu 200", async () => {
  const t = await createTenant();
  const { academicYear, term } = await createAcademicYearWithTerm(t.schoolId);
  assert.equal((await deleteTerm(term.id, t.adminToken)).body?.error?.code, "TERM_ACTIVE");
  const genap = (await postTerm(academicYear.id, GENAP, t.adminToken)).body!.data;
  const cls = await createClass(t.schoolId, academicYear.id);
  const { student } = await createStudent(t.schoolId, { classId: cls.id });
  const card = await prisma.reportCard.create({
    data: { schoolId: t.schoolId, studentId: student.id, termId: genap.id, classId: cls.id, classNameSnapshot: cls.name },
  });
  assert.equal((await deleteTerm(genap.id, t.adminToken)).body?.error?.code, "TERM_IN_USE");
  await prisma.reportCard.delete({ where: { id: card.id } });
  await alphaOn(t, "2027-02-01");
  assert.equal((await deleteTerm(genap.id, t.adminToken)).body?.error?.code, "TERM_HAS_ATTENDANCE");
  await prisma.attendance.deleteMany({ where: { schoolId: t.schoolId } });
  const res = await deleteTerm(genap.id, t.adminToken);
  assert.equal(res.status, 200);
  assert.equal(await prisma.term.count({ where: { id: genap.id } }), 0);
  assert.ok(await findAudit(genap.id, "term.delete"));
});

test("semester aktif: GET kosong -> null; PUT menetapkan + peringatan siswa di luar tahun ajaran", async () => {
  const t = await createTenant();
  const empty = await callRoute<Envelope<ActiveTerm>>(getActive, { method: "GET", url: "/api/v1/school/active-term", bearer: t.adminToken });
  assert.deepEqual(empty.body?.data, { term: null, academicYear: null });
  const old = await createAcademicYearWithTerm(t.schoolId, {
    name: "2025/2026", yearStart: "2025-07-14", yearEnd: "2026-06-27", termStart: "2025-07-14", termEnd: "2025-12-20", active: false,
  });
  const current = await createAcademicYearWithTerm(t.schoolId, { active: false });
  const oldClass = await createClass(t.schoolId, old.academicYear.id);
  const newClass = await createClass(t.schoolId, current.academicYear.id);
  await createStudent(t.schoolId, { classId: newClass.id });
  await createStudent(t.schoolId, { classId: oldClass.id });
  await createStudent(t.schoolId, { classId: null });
  await createStudent(t.schoolId, { classId: oldClass.id, status: "INACTIVE" });
  const res = await setActive(current.term.id, t.adminToken);
  assert.equal(res.status, 200, JSON.stringify(res.body?.error));
  assert.equal(res.body?.data.term?.isActive, true);
  assert.equal(res.body?.data.academicYear?.name, "2026/2027");
  assert.equal(res.body?.data.activeStudentsOutsideYear, 2);
  assert.ok(await findAudit(t.schoolId, "term.set_active"));
  const after = await callRoute<Envelope<ActiveTerm>>(getActive, { method: "GET", url: "/api/v1/school/active-term", bearer: t.adminToken });
  assert.equal(after.body?.data.term?.id, current.term.id);
  assert.equal(after.body?.data.term?.label, "Semester Ganjil 2026/2027");
  assert.equal((await setActive(undefined, t.adminToken)).status, 400);
});

test("peran salah -> 403", async () => {
  const res = await callRoute(getActive, { method: "GET", url: "/api/v1/school/active-term", bearer: env.studentToken });
  assert.equal(res.status, 403);
});

test("IDOR dua sekolah pada semester & semester aktif", async () => {
  const { academicYear, term } = await createAcademicYearWithTerm(env.a.schoolId, {
    name: "2031/2032", yearStart: "2031-07-14", yearEnd: "2032-06-26", termStart: "2031-07-14", termEnd: "2031-12-20", active: false,
  });
  assert.equal((await postTerm(academicYear.id, { semester: "GENAP", startDate: "2032-01-05", endDate: "2032-06-20" }, env.b.adminToken)).status, 404);
  assert.equal((await patchTerm(term.id, { endDate: "2031-12-19" }, env.b.adminToken)).status, 404);
  assert.equal((await deleteTerm(term.id, env.b.adminToken)).status, 404);
  assert.equal((await setActive(term.id, env.b.adminToken)).status, 404);
  const mismatch = await setActive(term.id, env.a.adminToken, env.b.schoolId);
  assert.equal(mismatch.status, 403);
  assert.equal(mismatch.body?.error?.code, "SCOPE_MISMATCH");
  assert.equal((await setActive(term.id, env.superToken)).body?.error?.code, "SCHOOL_ID_REQUIRED");
  assert.equal((await setActive(term.id, env.superToken, env.b.schoolId)).status, 404);
  const bySuper = await patchTerm(term.id, { endDate: "2031-12-19" }, env.superToken, env.a.schoolId);
  assert.equal(bySuper.status, 200);
  const school = await prisma.school.findUnique({ where: { id: env.b.schoolId }, select: { activeTermId: true } });
  assert.equal(school?.activeTermId, null);
});
