import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { GET as listYears, POST as createYear } from "@/app/api/v1/school/academic-years/route";
import { DELETE as deleteYear, PATCH as patchYear } from "@/app/api/v1/school/academic-years/[id]/route";
import { disconnect, prisma } from "../helpers/db";
import { createAcademicYearWithTerm, createClass } from "../helpers/factories";
import { callRoute, type Envelope } from "../helpers/request";
import { createTenant, findAudit, setupTenants, withSchool, type Tenant, type TwoTenants } from "./helpers";

interface Year {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  terms: Array<{ id: string; label: string; isActive: boolean }>;
}

const BASE = "/api/v1/school/academic-years";
const YEAR = { name: "2026/2027", startDate: "2026-07-13", endDate: "2027-06-26" };

let env: TwoTenants;
before(async () => {
  env = await setupTenants();
});
after(disconnect);

function post(body: unknown, token: string, schoolId?: string) {
  return callRoute<Envelope<Year>>(createYear, { method: "POST", url: withSchool(BASE, schoolId), bearer: token, json: body });
}

function patch(id: string, body: unknown, token: string, schoolId?: string) {
  return callRoute<Envelope<Year>>(patchYear, { method: "PATCH", url: withSchool(`${BASE}/${id}`, schoolId), bearer: token, json: body, params: { id } });
}

function remove(id: string, token: string, schoolId?: string) {
  return callRoute<Envelope<{ id: string }>>(deleteYear, { method: "DELETE", url: withSchool(`${BASE}/${id}`, schoolId), bearer: token, params: { id } });
}

async function freshYear(t: Tenant, body: unknown = YEAR): Promise<Year> {
  const res = await post(body, t.adminToken);
  assert.equal(res.status, 201, JSON.stringify(res.body?.error));
  return res.body!.data;
}

test("admin sekolah membuat tahun ajaran -> 201, tercatat di audit, muncul di daftar", async () => {
  const t = await createTenant();
  const year = await freshYear(t);
  assert.deepEqual({ name: year.name, startDate: year.startDate, endDate: year.endDate, terms: year.terms }, { ...YEAR, terms: [] });
  assert.ok(await findAudit(year.id, "academic_year.create"));
  const list = await callRoute<Envelope<Year[]>>(listYears, { method: "GET", url: BASE, bearer: t.adminToken });
  assert.equal(list.status, 200);
  assert.deepEqual(list.body?.data.map((y) => y.id), [year.id]);
});

test("validasi bentuk -> 400 (nama salah, kunci asing, tanggal tidak nyata)", async () => {
  const t = await createTenant();
  for (const body of [
    { ...YEAR, name: "2026/2028" },
    { ...YEAR, name: "26/27" },
    { ...YEAR, schoolId: env.b.schoolId },
    { ...YEAR, startDate: "2026-02-30" },
    { name: "2026/2027" },
  ]) {
    const res = await post(body, t.adminToken);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body?.error?.code, "VALIDATION_FAILED");
  }
});

test("aturan bisnis -> 422 (rentang terbalik, > 400 hari, tahun nama tidak cocok)", async () => {
  const t = await createTenant();
  const cases: Array<[unknown, string]> = [
    [{ ...YEAR, startDate: "2027-06-26", endDate: "2026-07-13" }, "INVALID_DATE_RANGE"],
    [{ ...YEAR, endDate: "2027-08-17" }, "ACADEMIC_YEAR_TOO_LONG"],
    [{ ...YEAR, name: "2025/2026" }, "ACADEMIC_YEAR_NAME_MISMATCH"],
  ];
  for (const [body, code] of cases) {
    const res = await post(body, t.adminToken);
    assert.equal(res.status, 422, code);
    assert.equal(res.body?.error?.code, code);
  }
  const ok = await post({ ...YEAR, endDate: "2027-08-16" }, t.adminToken);
  assert.equal(ok.status, 201, "tepat 400 hari diterima");
});

test("nama ganda dan rentang beririsan -> 409", async () => {
  const t = await createTenant();
  await freshYear(t);
  const dup = await post({ ...YEAR, startDate: "2026-08-01" }, t.adminToken);
  assert.equal(dup.status, 409);
  assert.equal(dup.body?.error?.code, "ACADEMIC_YEAR_NAME_TAKEN");
  const overlap = await post({ name: "2027/2028", startDate: "2027-06-26", endDate: "2028-06-24" }, t.adminToken);
  assert.equal(overlap.status, 409);
  assert.equal(overlap.body?.error?.code, "ACADEMIC_YEAR_OVERLAP");
  const next = await post({ name: "2027/2028", startDate: "2027-07-12", endDate: "2028-06-24" }, t.adminToken);
  assert.equal(next.status, 201);
});

test("PATCH: ubah tanggal; wajib tetap mencakup semester; body kosong -> 400", async () => {
  const t = await createTenant();
  const { academicYear } = await createAcademicYearWithTerm(t.schoolId, { active: false });
  const ok = await patch(academicYear.id, { endDate: "2027-06-30" }, t.adminToken);
  assert.equal(ok.status, 200);
  assert.equal(ok.body?.data.endDate, "2027-06-30");
  assert.equal(ok.body?.data.terms[0]?.label, "Semester Ganjil 2026/2027");
  assert.ok(await findAudit(academicYear.id, "academic_year.update"));
  const excludes = await patch(academicYear.id, { startDate: "2026-07-20" }, t.adminToken);
  assert.equal(excludes.status, 422);
  assert.equal(excludes.body?.error?.code, "ACADEMIC_YEAR_EXCLUDES_TERMS");
  const empty = await patch(academicYear.id, {}, t.adminToken);
  assert.equal(empty.status, 400);
});

test("DELETE hanya tahun ajaran tanpa semester & kelas", async () => {
  const t = await createTenant();
  const withTerm = await createAcademicYearWithTerm(t.schoolId, { active: false });
  const blocked = await remove(withTerm.academicYear.id, t.adminToken);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body?.error?.code, "ACADEMIC_YEAR_IN_USE");
  const withClass = await freshYear(t, { name: "2027/2028", startDate: "2027-07-12", endDate: "2028-06-24" });
  await createClass(t.schoolId, withClass.id);
  assert.equal((await remove(withClass.id, t.adminToken)).body?.error?.code, "ACADEMIC_YEAR_IN_USE");
  const empty = await freshYear(t, { name: "2028/2029", startDate: "2028-07-10", endDate: "2029-06-23" });
  const res = await remove(empty.id, t.adminToken);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body?.data, { id: empty.id });
  assert.equal(await prisma.academicYear.count({ where: { id: empty.id } }), 0);
  assert.ok(await findAudit(empty.id, "academic_year.delete"));
});

test("peran salah -> 403 (siswa)", async () => {
  const res = await callRoute(listYears, { method: "GET", url: BASE, bearer: env.studentToken });
  assert.equal(res.status, 403);
  assert.equal(res.body?.error?.code, "FORBIDDEN");
  const write = await post(YEAR, env.studentToken);
  assert.equal(write.status, 403);
});

test("IDOR dua sekolah: id sekolah lain -> 404, schoolId lain -> 403, super admin tanpa schoolId -> 400", async () => {
  const yearA = await freshYear(env.a, { name: "2030/2031", startDate: "2030-07-15", endDate: "2031-06-28" });
  const cross = await patch(yearA.id, { endDate: "2031-06-29" }, env.b.adminToken);
  assert.equal(cross.status, 404);
  assert.equal((await remove(yearA.id, env.b.adminToken)).status, 404);
  const mismatch = await callRoute(listYears, { method: "GET", url: withSchool(BASE, env.b.schoolId), bearer: env.a.adminToken });
  assert.equal(mismatch.status, 403);
  assert.equal(mismatch.body?.error?.code, "SCOPE_MISMATCH");
  const noSchool = await callRoute(listYears, { method: "GET", url: BASE, bearer: env.superToken });
  assert.equal(noSchool.status, 400);
  assert.equal(noSchool.body?.error?.code, "SCHOOL_ID_REQUIRED");
  const unknown = await callRoute(listYears, { method: "GET", url: withSchool(BASE, "sekolah-tidak-ada"), bearer: env.superToken });
  assert.equal(unknown.status, 404);
  const wrongSchool = await patch(yearA.id, { endDate: "2031-06-29" }, env.superToken, env.b.schoolId);
  assert.equal(wrongSchool.status, 404, "super admin dengan schoolId B tidak bisa menyentuh data A");
  const own = await patch(yearA.id, { endDate: "2031-06-29" }, env.superToken, env.a.schoolId);
  assert.equal(own.status, 200);
  const listB = await callRoute<Envelope<Year[]>>(listYears, { method: "GET", url: BASE, bearer: env.b.adminToken });
  assert.equal(listB.body?.data.some((y) => y.id === yearA.id), false);
});

test("?schoolId= kosong: admin sekolah tetap sekolahnya sendiri, super admin -> 400 SCHOOL_ID_REQUIRED", async () => {
  const own = await callRoute<Envelope<Year[]>>(listYears, { method: "GET", url: `${BASE}?schoolId=`, bearer: env.a.adminToken });
  assert.equal(own.status, 200);
  const sup = await callRoute(listYears, { method: "GET", url: `${BASE}?schoolId=`, bearer: env.superToken });
  assert.equal(sup.status, 400);
  assert.equal(sup.body?.error?.code, "SCHOOL_ID_REQUIRED");
});
