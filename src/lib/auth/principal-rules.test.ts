import { test } from "node:test";
import assert from "node:assert/strict";
import { checkLoginEligibility, evaluatePrincipal, type SessionRow } from "./principal-rules";

const NOW = new Date("2026-09-21T00:00:00Z");
const CLAIMS = { sub: "u1", sid: "sess" };
const row = (over: Partial<SessionRow> = {}, user: Partial<SessionRow["user"]> = {}): SessionRow => ({
  id: "sess",
  userId: "u1",
  platform: "ANDROID",
  deviceId: "dev-12345678",
  revokedAt: null,
  expiresAt: new Date("2026-10-01T00:00:00Z"),
  ...over,
  user: {
    id: "u1", role: "STUDENT", name: "Siswa", isActive: true, mustChangePassword: false, totpEnabledAt: null,
    schoolId: "s1", sponsorId: null, school: { isActive: true }, student: { id: "st1", status: "ACTIVE" }, sponsor: null,
    ...user,
  },
});

test("sesi hidup menghasilkan principal beku", () => {
  const res = evaluatePrincipal(row(), CLAIMS, NOW);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.principal.studentId, "st1");
    assert.ok(Object.isFrozen(res.principal));
  }
});

test("sesi hilang/dicabut/kedaluwarsa/sub beda -> SESSION_INVALID", () => {
  const invalid = { ok: false, code: "SESSION_INVALID" };
  assert.deepEqual(evaluatePrincipal(null, CLAIMS, NOW), invalid);
  assert.deepEqual(evaluatePrincipal(row({ revokedAt: NOW }), CLAIMS, NOW), invalid);
  assert.deepEqual(evaluatePrincipal(row({ expiresAt: NOW }), CLAIMS, NOW), invalid);
  assert.deepEqual(evaluatePrincipal(row(), { sub: "u2", sid: "sess" }, NOW), invalid);
});

test("akun/sekolah nonaktif atau siswa DRAFT -> ACCOUNT_INACTIVE", () => {
  const inactive = { ok: false, code: "ACCOUNT_INACTIVE" };
  assert.deepEqual(evaluatePrincipal(row({}, { isActive: false }), CLAIMS, NOW), inactive);
  assert.deepEqual(evaluatePrincipal(row({}, { school: { isActive: false } }), CLAIMS, NOW), inactive);
  assert.deepEqual(evaluatePrincipal(row({}, { student: { id: "st1", status: "DRAFT" } }), CLAIMS, NOW), inactive);
});

test("checkLoginEligibility: GRADUATED boleh, MOVED/INACTIVE tidak", () => {
  const base = { isActive: true, role: "STUDENT" as const, schoolActive: true };
  assert.deepEqual(checkLoginEligibility({ ...base, studentStatus: "GRADUATED" }), { ok: true });
  assert.deepEqual(checkLoginEligibility({ ...base, studentStatus: "MOVED" }), { ok: false, reason: "STUDENT_MOVED" });
  assert.deepEqual(checkLoginEligibility({ ...base, studentStatus: "INACTIVE" }), { ok: false, reason: "STUDENT_INACTIVE" });
  assert.deepEqual(checkLoginEligibility({ isActive: true, role: "SPONSOR", schoolActive: null, studentStatus: null }), { ok: true });
});

test("totpEnrollmentRequired: SUPER_ADMIN tanpa totpEnabledAt -> true; sudah aktif atau peran lain -> false", () => {
  const sa = { role: "SUPER_ADMIN" as const, schoolId: null, school: null, student: null };
  const pending = evaluatePrincipal(row({}, { ...sa, totpEnabledAt: null }), CLAIMS, NOW);
  const enrolled = evaluatePrincipal(row({}, { ...sa, totpEnabledAt: NOW }), CLAIMS, NOW);
  assert.equal(pending.ok && pending.principal.totpEnrollmentRequired, true);
  assert.equal(enrolled.ok && enrolled.principal.totpEnrollmentRequired, false);
  const student = evaluatePrincipal(row(), CLAIMS, NOW);
  assert.equal(student.ok && student.principal.totpEnrollmentRequired, false);
});
