import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { POST as activate } from "@/app/api/v1/school/students/[id]/activate/route";
import { POST as resetPassword } from "@/app/api/v1/school/students/[id]/reset-password/route";
import { PATCH as patchOne } from "@/app/api/v1/school/students/[id]/route";
import { POST as changeStatus } from "@/app/api/v1/school/students/[id]/status/route";
import { POST as create } from "@/app/api/v1/school/students/route";
import { verifyPassword } from "@/lib/auth/password";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { createSessionToken } from "../helpers/auth";
import { disconnect, prisma } from "../helpers/db";
import { createStudent, uniqNisn } from "../helpers/factories";
import { callRoute, type Envelope } from "../helpers/request";
import { completeStudentBody, createSchoolFixture, createSuperAdminToken, studentUrl, type SchoolFixture } from "./helpers";

type StatusBody = Envelope<{ student: { status: string; hasActiveNisn: boolean; user: { isActive: boolean }; activatedAt: string | null }; nisnReleased: boolean; revokedSessions: number; voidedInvoiceIds: string[] }>;

let a: SchoolFixture;
let b: SchoolFixture;
let superToken = "";

before(async () => {
  resetAllLimiters();
  [a, b] = await Promise.all([createSchoolFixture(), createSchoolFixture()]);
  superToken = (await createSuperAdminToken()).token;
});
after(disconnect);

const setStatus = (fx: SchoolFixture, id: string, json: unknown) =>
  callRoute<StatusBody>(changeStatus, { method: "POST", url: studentUrl(`/${id}/status`), params: { id }, bearer: fx.adminToken, json });

async function sessionState(sessionId: string): Promise<{ revokedAt: Date | null; revokeReason: string | null }> {
  const session = await prisma.authSession.findUniqueOrThrow({ where: { id: sessionId }, select: { revokedAt: true, revokeReason: true } });
  return session;
}

describe("transisi status", () => {
  test("ACTIVE -> INACTIVE -> ACTIVE -> GRADUATED -> MOVED -> ACTIVE menjaga User.isActive, sesi, dan activeNisn", async () => {
    const { student, user } = await createStudent(a.school.id, { classId: a.klass.id });
    const s1 = await createSessionToken(user.id);

    const inactive = await setStatus(a, student.id, { to: "INACTIVE", reason: "Cuti panjang" });
    assert.equal(inactive.status, 200, JSON.stringify(inactive.body));
    assert.equal(inactive.body?.data.student.user.isActive, false);
    assert.equal(inactive.body?.data.student.hasActiveNisn, true);
    assert.equal(inactive.body?.data.revokedSessions, 1);
    assert.equal((await sessionState(s1.sessionId)).revokeReason, "ACCOUNT_DISABLED");

    const back = await setStatus(a, student.id, { to: "ACTIVE" });
    assert.equal(back.status, 200);
    assert.equal(back.body?.data.student.user.isActive, true);

    const s2 = await createSessionToken(user.id);
    const graduated = await setStatus(a, student.id, { to: "GRADUATED", reason: "Lulus 2026" });
    assert.equal(graduated.body?.data.student.status, "GRADUATED");
    assert.equal(graduated.body?.data.student.user.isActive, true);
    assert.equal((await sessionState(s2.sessionId)).revokedAt, null);

    const moved = await setStatus(a, student.id, { to: "MOVED", reason: "Pindah kota" });
    assert.equal(moved.status, 200);
    assert.equal(moved.body?.data.student.hasActiveNisn, false);
    assert.equal(moved.body?.data.student.user.isActive, false);
    assert.deepEqual(moved.body?.data.voidedInvoiceIds, []);
    assert.equal((await sessionState(s2.sessionId)).revokeReason, "ACCOUNT_DISABLED");

    const reactivated = await setStatus(a, student.id, { to: "ACTIVE" });
    assert.equal(reactivated.status, 200);
    assert.equal(reactivated.body?.data.student.hasActiveNisn, true);
    const row = await prisma.student.findFirst({ where: { id: student.id, schoolId: a.school.id }, include: { user: true } });
    assert.equal(row?.activeNisn, row?.nisn);
    assert.equal(row?.user.isActive, true);
    const audits = await prisma.auditLog.count({ where: { action: "student.status_change", entityId: student.id, schoolId: a.school.id } });
    assert.equal(audits, 5);
  });

  test("transisi tidak sah -> 409 INVALID_STATUS_TRANSITION; alasan wajib -> 400", async () => {
    const draft = await createStudent(a.school.id, { status: "DRAFT" });
    const bad = await setStatus(a, draft.student.id, { to: "INACTIVE", reason: "tidak boleh" });
    assert.equal(bad.status, 409);
    assert.equal(bad.body?.error?.code, "INVALID_STATUS_TRANSITION");
    const active = await createStudent(a.school.id, { classId: a.klass.id });
    const same = await setStatus(a, active.student.id, { to: "ACTIVE" });
    assert.equal(same.status, 409);
    const noReason = await setStatus(a, active.student.id, { to: "MOVED" });
    assert.equal(noReason.status, 400);
    assert.equal((await setStatus(a, active.student.id, { to: "DRAFT", reason: "x y z" })).status, 400);
  });

  test("aktivasi DRAFT: data kurang -> 422 tanpa perubahan; lengkap -> ACTIVE + activatedAt", async () => {
    const incomplete = await createStudent(a.school.id, { status: "DRAFT", classId: a.klass.id, data: { guardianPhone: null } });
    const res = await callRoute(activate, { method: "POST", url: studentUrl(`/${incomplete.student.id}/activate`), params: { id: incomplete.student.id }, bearer: a.adminToken, json: {} });
    assert.equal(res.status, 422);
    assert.equal(res.body?.error?.code, "ACTIVATION_INCOMPLETE");
    const still = await prisma.student.findFirst({ where: { id: incomplete.student.id, schoolId: a.school.id } });
    assert.equal(still?.status, "DRAFT");
    const complete = await createStudent(a.school.id, { status: "DRAFT", classId: a.klass.id });
    const ok = await callRoute<StatusBody>(activate, { method: "POST", url: studentUrl(`/${complete.student.id}/activate`), params: { id: complete.student.id }, bearer: a.adminToken, json: {} });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body?.data.student.status, "ACTIVE");
    assert.ok(ok.body?.data.student.activatedAt);
    assert.equal(ok.body?.data.student.user.isActive, true);
  });
});

describe("klaim NISN lintas sekolah", () => {
  test("NISN milik siswa LULUS di sekolah A dilepas saat sekolah B mengaktifkan: sesi dicabut, audit & notifikasi di sekolah A", async () => {
    const holder = await createStudent(a.school.id, { status: "GRADUATED", name: "Alumni Lepas" });
    const holderSession = await createSessionToken(holder.user.id);
    const res = await callRoute<{ data: { student: { id: string }; nisnReleased: boolean } }>(create, {
      method: "POST", url: studentUrl(""), bearer: b.adminToken, json: completeStudentBody(b.klass.id, { nisn: holder.student.nisn, confirmReleaseGraduatedNisn: true }),
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body?.data.nisnReleased, true);
    const released = await prisma.student.findFirst({ where: { id: holder.student.id, schoolId: a.school.id } });
    assert.equal(released?.activeNisn, null);
    assert.equal(released?.status, "GRADUATED");
    assert.equal((await sessionState(holderSession.sessionId)).revokeReason, "ACCOUNT_DISABLED");
    const audit = await prisma.auditLog.findFirst({ where: { action: "student.nisn_release", entityId: holder.student.id } });
    assert.equal(audit?.schoolId, a.school.id);
    assert.equal(audit?.actorId, null);
    const notification = await prisma.notification.findFirst({ where: { userId: a.admin.id, type: "NISN_RELEASED" }, orderBy: { createdAt: "desc" } });
    assert.ok(notification);
    assert.doesNotMatch(JSON.stringify(notification), new RegExp(`${b.school.id}|${res.body?.data.student.id}`));
    const newAudit = await prisma.auditLog.findFirst({ where: { action: "student.create", entityId: res.body?.data.student.id } });
    assert.equal(newAudit?.schoolId, b.school.id);
    assert.doesNotMatch(JSON.stringify(newAudit), new RegExp(`${holder.student.id}|${a.school.id}`));
  });

  test("NISN masih AKTIF di sekolah lain -> 409 NISN_ACTIVE_ELSEWHERE; nama sekolah hanya untuk super admin", async () => {
    const holder = await createStudent(a.school.id);
    const draft = await createStudent(b.school.id, { status: "DRAFT", classId: b.klass.id, nisn: holder.student.nisn });
    const url = studentUrl(`/${draft.student.id}/activate`);
    const asAdmin = await callRoute(activate, { method: "POST", url, params: { id: draft.student.id }, bearer: b.adminToken, json: {} });
    assert.equal(asAdmin.status, 409);
    assert.equal(asAdmin.body?.error?.code, "NISN_ACTIVE_ELSEWHERE");
    assert.equal(asAdmin.body?.error?.details, null);
    const asSuper = await callRoute(activate, { method: "POST", url: studentUrl(`/${draft.student.id}/activate`, b.school.id), params: { id: draft.student.id }, bearer: superToken, json: {} });
    assert.equal(asSuper.status, 409);
    assert.deepEqual((asSuper.body?.error?.details as { schoolName: string }).schoolName, a.school.name);
  });

  test("dua aktivasi bersamaan untuk NISN yang sama di dua sekolah -> tepat satu 200 dan satu 409", async () => {
    const nisn = uniqNisn();
    const [da, db] = await Promise.all([
      createStudent(a.school.id, { status: "DRAFT", classId: a.klass.id, nisn }),
      createStudent(b.school.id, { status: "DRAFT", classId: b.klass.id, nisn }),
    ]);
    const results = await Promise.all([
      callRoute(activate, { method: "POST", url: studentUrl(`/${da.student.id}/activate`), params: { id: da.student.id }, bearer: a.adminToken, json: {} }),
      callRoute(activate, { method: "POST", url: studentUrl(`/${db.student.id}/activate`), params: { id: db.student.id }, bearer: b.adminToken, json: {} }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [200, 409], JSON.stringify(results.map((r) => r.body?.error)));
    const loser = results.find((r) => r.status === 409);
    assert.ok(["NISN_ACTIVE_ELSEWHERE", "CONFLICT_RETRY"].includes(loser?.body?.error?.code ?? ""), loser?.body?.error?.code);
    assert.equal(await prisma.student.count({ where: { activeNisn: nisn } }), 1);
  });

  test("super admin mengganti NISN siswa AKTIF: klaim ulang + sesi dicabut", async () => {
    const { student, user } = await createStudent(a.school.id, { classId: a.klass.id });
    const session = await createSessionToken(user.id);
    const nisn = uniqNisn();
    const res = await callRoute<{ data: { nisn: string; hasActiveNisn: boolean } }>(patchOne, {
      method: "PATCH", url: studentUrl(`/${student.id}`, a.school.id), params: { id: student.id }, bearer: superToken, json: { nisn },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body?.data.nisn, nisn);
    const row = await prisma.student.findFirst({ where: { id: student.id, schoolId: a.school.id } });
    assert.equal(row?.activeNisn, nisn);
    assert.equal((await sessionState(session.sessionId)).revokeReason, "ADMIN_REVOKED");
  });
});

describe("reset kata sandi", () => {
  test("kata sandi baru di-generate, wajib ganti, 14 hari, semua sesi dicabut, audit tanpa kata sandi", async () => {
    const { student, user } = await createStudent(a.school.id, { classId: a.klass.id });
    const session = await createSessionToken(user.id);
    const res = await callRoute<{ data: { temporaryPassword: string; mustChangePassword: boolean; revokedSessions: number; tempPasswordExpiresAt: string } }>(resetPassword, {
      method: "POST", url: studentUrl(`/${student.id}/reset-password`), params: { id: student.id }, bearer: a.adminToken,
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const data = res.body?.data;
    assert.ok(data && data.temporaryPassword.length === 10);
    assert.equal(data.mustChangePassword, true);
    assert.equal(data.revokedSessions, 1);
    const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, omit: { passwordHash: false } });
    assert.equal(await verifyPassword(data.temporaryPassword, dbUser.passwordHash), true);
    assert.equal(dbUser.mustChangePassword, true);
    assert.equal(dbUser.tempPasswordExpiresAt?.toISOString(), data.tempPasswordExpiresAt);
    assert.equal((await sessionState(session.sessionId)).revokeReason, "ADMIN_REVOKED");
    const audit = await prisma.auditLog.findFirst({ where: { action: "student.reset_password", entityId: student.id } });
    assert.ok(audit);
    assert.doesNotMatch(JSON.stringify(audit), new RegExp(data.temporaryPassword));
  });

  test("kata sandi tidak pernah diambil dari request (body diabaikan)", async () => {
    const { student } = await createStudent(a.school.id, { classId: a.klass.id });
    const res = await callRoute(resetPassword, {
      method: "POST", url: studentUrl(`/${student.id}/reset-password`), params: { id: student.id }, bearer: a.adminToken, json: { newPassword: "Rahasia123" },
    });
    assert.equal(res.status, 200);
    const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: student.userId }, omit: { passwordHash: false } });
    assert.equal(await verifyPassword("Rahasia123", dbUser.passwordHash), false);
  });
});
