import { test } from "node:test";
import assert from "node:assert/strict";
import { makePrincipal } from "../test-principal";
import { authorize, can, isAction, listAllowedActions } from "./index";

const codeOf = (fn: () => void): string | null => {
  try {
    fn();
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "unknown";
  }
};

test("peran di luar daftar ditolak FORBIDDEN", () => {
  assert.equal(codeOf(() => authorize(makePrincipal({ role: "STUDENT", studentStatus: "ACTIVE" }), "platform.jobs.read")), "FORBIDDEN");
  assert.equal(codeOf(() => authorize(makePrincipal({ role: "SUPER_ADMIN", schoolId: null }), "platform.jobs.read")), null);
});

test("mustChangePassword memblokir kecuali aksi allowlist", () => {
  const p = makePrincipal({ mustChangePassword: true });
  assert.equal(codeOf(() => authorize(p, "notification.self")), "PASSWORD_CHANGE_REQUIRED");
  assert.equal(codeOf(() => authorize(p, "auth.self")), null);
});

test("status siswa & sponsor mengikuti aturan", () => {
  const graduated = makePrincipal({ role: "STUDENT", studentStatus: "GRADUATED" });
  assert.equal(can(graduated, "notification.self"), true);
  const suspended = makePrincipal({ role: "SPONSOR", schoolId: null, sponsorId: "sp", sponsorStatus: "SUSPENDED" });
  assert.equal(can(suspended, "region.read"), true);
  assert.equal(codeOf(() => authorize(makePrincipal({ role: "STUDENT", studentStatus: "INACTIVE" }), "notification.self")), "STUDENT_NOT_ACTIVE");
});

test("isAction & listAllowedActions", () => {
  assert.equal(isAction("auth.self"), true);
  assert.equal(isAction("tidak.ada"), false);
  assert.ok(listAllowedActions(makePrincipal({ role: "SUPER_ADMIN", schoolId: null })).includes("platform.jobs.read"));
});

test("SUPER_ADMIN tanpa TOTP aktif: hanya auth.self & auth.totp; aksi /platform ditolak TOTP_ENROLLMENT_REQUIRED", () => {
  const pending = makePrincipal({ role: "SUPER_ADMIN", schoolId: null, totpEnrollmentRequired: true });
  assert.equal(codeOf(() => authorize(pending, "platform.jobs.read")), "TOTP_ENROLLMENT_REQUIRED");
  assert.equal(codeOf(() => authorize(pending, "users.manage")), "TOTP_ENROLLMENT_REQUIRED");
  assert.equal(codeOf(() => authorize(pending, "notification.self")), "TOTP_ENROLLMENT_REQUIRED");
  assert.equal(codeOf(() => authorize(pending, "auth.self")), null);
  assert.equal(codeOf(() => authorize(pending, "auth.totp")), null);
  assert.deepEqual(listAllowedActions(pending).sort(), ["auth.self", "auth.totp"]);
});

test("auth.totp: hanya SUPER_ADMIN, dan ditolak selama wajib ganti kata sandi", () => {
  assert.equal(codeOf(() => authorize(makePrincipal(), "auth.totp")), "FORBIDDEN");
  const mustChange = makePrincipal({ role: "SUPER_ADMIN", schoolId: null, mustChangePassword: true, totpEnrollmentRequired: true });
  assert.equal(codeOf(() => authorize(mustChange, "auth.totp")), "PASSWORD_CHANGE_REQUIRED");
  assert.equal(codeOf(() => authorize(makePrincipal({ role: "SUPER_ADMIN", schoolId: null }), "auth.totp")), null);
});
