/**
 * Pelepasan NISN milik siswa LULUS di sekolah lain:
 * (1) wajib opt-in eksplisit confirmReleaseGraduatedNisn (create / activate / status / impor);
 * (2) kuota harian per sekolah pengklaim untuk admin sekolah (super admin dikecualikan);
 * (3) audit di kedua sekolah tanpa id asing + notifikasi super admin tanpa data pemegang lama;
 * plus pelepasan batch saat commit impor.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { POST as activate } from "@/app/api/v1/school/students/[id]/activate/route";
import { POST as changeStatus } from "@/app/api/v1/school/students/[id]/status/route";
import { POST as importRoute } from "@/app/api/v1/school/students/import/route";
import { POST as create } from "@/app/api/v1/school/students/route";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { NISN_RELEASE_DAILY_LIMIT } from "@/lib/students/nisn-rules";
import { createSessionToken } from "../helpers/auth";
import { disconnect, prisma } from "../helpers/db";
import { createStudent, type TestStudent } from "../helpers/factories";
import { callRoute, type Envelope } from "../helpers/request";
import { IMPORT_HEADER, callMultipart, completeStudentBody, countSchoolStudents, createSchoolFixture, createSuperAdminToken, csvBlob, importForm, importRow, studentUrl, type SchoolFixture } from "./helpers";

type Body = Envelope<{ nisnReleased?: boolean; created?: number; report?: { rows: Array<{ warnings: string[] }> } }>;

let superAdmin: { id: string; token: string };

before(async () => {
  const sa = await createSuperAdminToken();
  superAdmin = { id: sa.user.id, token: sa.token };
});
beforeEach(() => resetAllLimiters());
after(disconnect);

const importUrl = (schoolId?: string) => `/api/v1/school/students/import${schoolId ? `?schoolId=${schoolId}` : ""}`;

const createAs = (token: string, classId: string, overrides: Record<string, unknown>, schoolId?: string) =>
  callRoute<Body>(create, { method: "POST", url: studentUrl("", schoolId), bearer: token, json: completeStudentBody(classId, overrides) });

const sendImport = (token: string, rows: readonly (readonly string[])[], fields: Record<string, string>, schoolId?: string) =>
  callMultipart<Body>(importRoute, { url: importUrl(schoolId), form: importForm(csvBlob(rows), "siswa.csv", fields), bearer: token });

const graduates = (schoolId: string, count: number, name = "Alumni Rahasia"): Promise<TestStudent[]> =>
  Promise.all(Array.from({ length: count }, () => createStudent(schoolId, { status: "GRADUATED", name })));

const activeNisnOf = async (holder: TestStudent) => (await prisma.student.findFirst({ where: { id: holder.student.id, schoolId: holder.student.schoolId } }))?.activeNisn;

describe("opt-in confirmReleaseGraduatedNisn", () => {
  let claimer: SchoolFixture;
  let origin: SchoolFixture;
  before(async () => {
    [claimer, origin] = await Promise.all([createSchoolFixture(), createSchoolFixture()]);
  });

  test("tanpa opt-in: create / activate / status ke ACTIVE -> 409 NISN_HELD_BY_GRADUATE, pemegang tidak berubah", async () => {
    const [holder] = await graduates(origin.school.id, 1);
    assert.ok(holder);
    const nisn = holder.student.nisn;
    const created = await createAs(claimer.adminToken, claimer.klass.id, { nisn });
    assert.equal(created.status, 409, JSON.stringify(created.body));
    assert.equal(created.body?.error?.code, "NISN_HELD_BY_GRADUATE");
    assert.doesNotMatch(JSON.stringify(created.body), new RegExp(`${holder.student.id}|${origin.school.id}`));
    const draft = await createStudent(claimer.school.id, { status: "DRAFT", classId: claimer.klass.id, nisn });
    const url = studentUrl(`/${draft.student.id}/activate`);
    const viaActivate = await callRoute<Body>(activate, { method: "POST", url, params: { id: draft.student.id }, bearer: claimer.adminToken, json: {} });
    assert.equal(viaActivate.body?.error?.code, "NISN_HELD_BY_GRADUATE");
    const viaStatus = await callRoute<Body>(changeStatus, {
      method: "POST", url: studentUrl(`/${draft.student.id}/status`), params: { id: draft.student.id }, bearer: claimer.adminToken, json: { to: "ACTIVE" },
    });
    assert.equal(viaStatus.status, 409);
    assert.equal(viaStatus.body?.error?.code, "NISN_HELD_BY_GRADUATE");
    assert.equal(await activeNisnOf(holder), nisn);
    assert.equal((await prisma.student.findFirst({ where: { id: draft.student.id, schoolId: claimer.school.id } }))?.status, "DRAFT");
  });

  test("impor tanpa opt-in: dry-run memberi petunjuk flag, commit 409 tanpa menulis apa pun", async () => {
    const [holder] = await graduates(origin.school.id, 1);
    assert.ok(holder);
    const rows = [IMPORT_HEADER, importRow(claimer.klass.name, { 0: holder.student.nisn }), importRow(claimer.klass.name)];
    const dry = await sendImport(claimer.adminToken, rows, {});
    assert.equal(dry.status, 200, JSON.stringify(dry.body));
    assert.match(dry.body?.data.report?.rows[0]?.warnings.join(" ") ?? "", /confirmReleaseGraduatedNisn/);
    const before = await countSchoolStudents(claimer.school.id);
    const commit = await sendImport(claimer.adminToken, rows, { dryRun: "false" });
    assert.equal(commit.status, 409, JSON.stringify(commit.body));
    assert.equal(commit.body?.error?.code, "NISN_HELD_BY_GRADUATE");
    assert.deepEqual(await countSchoolStudents(claimer.school.id), before);
    assert.equal(await activeNisnOf(holder), holder.student.nisn);
  });

  test("dengan opt-in: dilepas; audit klaim di sekolah pengklaim & notifikasi super admin tanpa data pemegang lama", async () => {
    const [holder] = await graduates(origin.school.id, 1, "Alumni Tersembunyi");
    assert.ok(holder);
    const nisn = holder.student.nisn;
    const res = await createAs(claimer.adminToken, claimer.klass.id, { nisn, confirmReleaseGraduatedNisn: true });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body?.data.nisnReleased, true);
    assert.equal(await activeNisnOf(holder), null);
    const claimed = await prisma.auditLog.findFirst({ where: { action: "student.nisn_release_claimed", schoolId: claimer.school.id }, orderBy: { createdAt: "desc" } });
    assert.deepEqual(claimed?.after, { count: 1, nisns: [nisn] });
    assert.equal(claimed?.actorId, claimer.admin.id);
    const foreign = new RegExp(`${holder.student.id}|${holder.user.id}|${origin.school.id}|Alumni Tersembunyi`);
    assert.doesNotMatch(JSON.stringify(claimed), foreign);
    const notice = await prisma.notification.findFirst({ where: { userId: superAdmin.id, type: "NISN_RELEASED", body: { contains: nisn } } });
    assert.ok(notice, "super admin harus diberi tahu");
    assert.match(notice.body, new RegExp(claimer.school.name));
    assert.doesNotMatch(JSON.stringify(notice), new RegExp(`${foreign.source}|${origin.school.name}`));
    assert.ok(await prisma.auditLog.findFirst({ where: { action: "student.nisn_release", entityId: holder.student.id, schoolId: origin.school.id } }));
  });
});

describe("kuota harian pelepasan per sekolah pengklaim", () => {
  test("admin sekolah: pelepasan ke-(LIMIT+1) hari ini -> 429 NISN_RELEASE_LIMIT + Retry-After; kemarin & super admin tidak dihitung; super admin dikecualikan", async () => {
    const [claimer, origin] = await Promise.all([createSchoolFixture(), createSchoolFixture()]);
    const now = Date.now();
    const seed = (after: object, extra: Record<string, unknown>) =>
      prisma.auditLog.create({
        data: { schoolId: claimer.school.id, action: "student.nisn_release_claimed", entityType: "School", entityId: claimer.school.id, after, ...extra },
      });
    await seed({ count: NISN_RELEASE_DAILY_LIMIT - 1, nisns: [] }, { actorId: claimer.admin.id, actorRole: "SCHOOL_ADMIN" });
    await seed({ count: 50, nisns: [] }, { actorId: claimer.admin.id, actorRole: "SCHOOL_ADMIN", createdAt: new Date(now - 30 * 3_600_000) });
    await seed({ count: 50, nisns: [] }, { actorId: superAdmin.id, actorRole: "SUPER_ADMIN" });
    const [h1, h2] = await graduates(origin.school.id, 2);
    assert.ok(h1 && h2);
    const last = await createAs(claimer.adminToken, claimer.klass.id, { nisn: h1.student.nisn, confirmReleaseGraduatedNisn: true });
    assert.equal(last.status, 201, JSON.stringify(last.body));
    const over = await createAs(claimer.adminToken, claimer.klass.id, { nisn: h2.student.nisn, confirmReleaseGraduatedNisn: true });
    assert.equal(over.status, 429, JSON.stringify(over.body));
    assert.equal(over.body?.error?.code, "NISN_RELEASE_LIMIT");
    assert.ok(Number(over.headers.get("retry-after")) > 0);
    assert.equal(await activeNisnOf(h2), h2.student.nisn);
    assert.equal(await prisma.student.count({ where: { schoolId: claimer.school.id, nisn: h2.student.nisn } }), 0);
    const bySuper = await createAs(superAdmin.token, claimer.klass.id, { nisn: h2.student.nisn, confirmReleaseGraduatedNisn: true }, claimer.school.id);
    assert.equal(bySuper.status, 201, JSON.stringify(bySuper.body));
    assert.equal(await activeNisnOf(h2), null);
  });

  test("impor: LIMIT+1 pemegang LULUS sekaligus -> 429 tanpa menulis apa pun; super admin -> 200, pelepasan batch", async () => {
    const [claimer, originA, originB] = await Promise.all([createSchoolFixture(), createSchoolFixture(), createSchoolFixture()]);
    const holders = [...(await graduates(originA.school.id, NISN_RELEASE_DAILY_LIMIT - 1)), ...(await graduates(originB.school.id, 2))];
    const sessions = await Promise.all(holders.slice(0, 2).concat(holders.slice(-1)).map((h) => createSessionToken(h.user.id)));
    const rows = [IMPORT_HEADER, ...holders.map((h) => importRow(claimer.klass.name, { 0: h.student.nisn }))];
    const fields = { dryRun: "false", confirmReleaseGraduatedNisn: "true" };
    const before = await countSchoolStudents(claimer.school.id);
    const limited = await sendImport(claimer.adminToken, rows, fields);
    assert.equal(limited.status, 429, JSON.stringify(limited.body));
    assert.equal(limited.body?.error?.code, "NISN_RELEASE_LIMIT");
    assert.deepEqual(await countSchoolStudents(claimer.school.id), before);
    assert.equal(await activeNisnOf(holders[0] as TestStudent), holders[0]?.student.nisn);
    const ok = await sendImport(superAdmin.token, rows, fields, claimer.school.id);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body?.data.created, holders.length);
    const ids = holders.map((h) => h.student.id);
    assert.equal(await prisma.student.count({ where: { id: { in: ids }, activeNisn: null, status: "GRADUATED" } }), holders.length);
    const revoked = await prisma.authSession.count({ where: { id: { in: sessions.map((s) => s.sessionId) }, revokeReason: "ACCOUNT_DISABLED" } });
    assert.equal(revoked, sessions.length);
    assert.equal(await prisma.auditLog.count({ where: { action: "student.nisn_release", entityId: { in: ids } } }), holders.length);
    const claimed = await prisma.auditLog.findFirst({ where: { action: "student.nisn_release_claimed", schoolId: claimer.school.id } });
    assert.equal((claimed?.after as { count: number }).count, holders.length);
    assert.equal(claimed?.actorRole, "SUPER_ADMIN");
    for (const origin of [originA, originB]) {
      assert.equal(await prisma.notification.count({ where: { userId: origin.admin.id, type: "NISN_RELEASED" } }), 1);
    }
  });
});
