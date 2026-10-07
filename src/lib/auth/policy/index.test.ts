import { test } from "node:test";
import assert from "node:assert/strict";
import { makePrincipal } from "../test-principal";
import { assertImpersonationAllowed, authorize, can, isAction, listAllowedActions } from "./index";

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

test("Masuk sebagai: keamanan akun milik pemilik ditolak IMPERSONATION_FORBIDDEN; aksi lain tetap jalan", () => {
  const impersonated = makePrincipal({ role: "SCHOOL_ADMIN", impersonatorId: "sa1" });
  for (const action of ["auth.account", "auth.email", "notification.push"] as const) {
    assert.equal(codeOf(() => authorize(impersonated, action)), "IMPERSONATION_FORBIDDEN", action);
  }
  assert.equal(codeOf(() => authorize(impersonated, "auth.self")), null, "me/logout tetap boleh");
  assert.equal(codeOf(() => authorize(impersonated, "notification.self")), null);
  assert.equal(codeOf(() => authorize(makePrincipal({ role: "SCHOOL_ADMIN" }), "auth.account")), null, "pemilik akun sendiri boleh");
  assert.equal(codeOf(() => authorize(makePrincipal({ mustChangePassword: true }), "auth.account")), null, "ganti sandi saat wajib ganti");
  assert.ok(!listAllowedActions(impersonated).includes("auth.account"));
});

test("Masuk sebagai = mode lihat: semua perubahan (non-GET) ditolak kecuali auth.self (keluar/akhiri)", () => {
  const impersonated = makePrincipal({ role: "SCHOOL_ADMIN", impersonatorId: "sa1" });
  assert.equal(codeOf(() => assertImpersonationAllowed(impersonated, "students.manage", "PATCH")), "IMPERSONATION_FORBIDDEN");
  assert.equal(codeOf(() => assertImpersonationAllowed(impersonated, "notification.self", "POST")), "IMPERSONATION_FORBIDDEN");
  assert.equal(codeOf(() => assertImpersonationAllowed(impersonated, "students.manage", "GET")), null);
  assert.equal(codeOf(() => assertImpersonationAllowed(impersonated, "auth.self", "POST")), null);
  assert.equal(codeOf(() => assertImpersonationAllowed(makePrincipal({ role: "SCHOOL_ADMIN" }), "students.manage", "PATCH")), null, "sesi biasa tidak terpengaruh");
});

test("users.impersonate: hanya super admin", () => {
  assert.equal(codeOf(() => authorize(makePrincipal({ role: "SUPER_ADMIN", schoolId: null }), "users.impersonate")), null);
  assert.equal(codeOf(() => authorize(makePrincipal({ role: "SCHOOL_ADMIN" }), "users.impersonate")), "FORBIDDEN");
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

test("SUPER_ADMIN tanpa TOTP aktif: hanya auth.self, auth.account & auth.totp; aksi /platform ditolak TOTP_ENROLLMENT_REQUIRED", () => {
  const pending = makePrincipal({ role: "SUPER_ADMIN", schoolId: null, totpEnrollmentRequired: true });
  assert.equal(codeOf(() => authorize(pending, "platform.jobs.read")), "TOTP_ENROLLMENT_REQUIRED");
  assert.equal(codeOf(() => authorize(pending, "users.manage")), "TOTP_ENROLLMENT_REQUIRED");
  assert.equal(codeOf(() => authorize(pending, "notification.self")), "TOTP_ENROLLMENT_REQUIRED");
  assert.equal(codeOf(() => authorize(pending, "auth.self")), null);
  assert.equal(codeOf(() => authorize(pending, "auth.totp")), null);
  assert.deepEqual(listAllowedActions(pending).sort(), ["auth.account", "auth.self", "auth.totp"]);
});

test("auth.totp: hanya SUPER_ADMIN, dan ditolak selama wajib ganti kata sandi", () => {
  assert.equal(codeOf(() => authorize(makePrincipal(), "auth.totp")), "FORBIDDEN");
  const mustChange = makePrincipal({ role: "SUPER_ADMIN", schoolId: null, mustChangePassword: true, totpEnrollmentRequired: true });
  assert.equal(codeOf(() => authorize(mustChange, "auth.totp")), "PASSWORD_CHANGE_REQUIRED");
  assert.equal(codeOf(() => authorize(makePrincipal({ role: "SUPER_ADMIN", schoolId: null }), "auth.totp")), null);
});

test("schoolAdmins.manage: hanya admin UTAMA (dan super admin); admin tambahan cukup schoolAdmins.read", () => {
  const extra = makePrincipal({ role: "SCHOOL_ADMIN", isPrimarySchoolAdmin: false });
  assert.equal(codeOf(() => authorize(extra, "schoolAdmins.manage")), "PRIMARY_ADMIN_ONLY");
  assert.equal(codeOf(() => authorize(extra, "schoolAdmins.read")), null);
  assert.equal(codeOf(() => authorize(makePrincipal({ role: "SCHOOL_ADMIN", isPrimarySchoolAdmin: true }), "schoolAdmins.manage")), null);
  assert.equal(codeOf(() => authorize(makePrincipal({ role: "SUPER_ADMIN", schoolId: null }), "schoolAdmins.manage")), null);
  assert.equal(codeOf(() => authorize(makePrincipal({ role: "STUDENT", studentStatus: "ACTIVE" }), "schoolAdmins.read")), "FORBIDDEN");
  assert.ok(!listAllowedActions(extra).includes("schoolAdmins.manage"));
});

test("notification.preferences (N2): admin sekolah utama & tambahan; peran lain ditolak; wajib ganti sandi diblokir", () => {
  for (const isPrimarySchoolAdmin of [true, false]) {
    assert.equal(codeOf(() => authorize(makePrincipal({ role: "SCHOOL_ADMIN", isPrimarySchoolAdmin }), "notification.preferences")), null);
  }
  assert.equal(codeOf(() => authorize(makePrincipal({ role: "STUDENT", studentStatus: "ACTIVE" }), "notification.preferences")), "FORBIDDEN");
  assert.equal(codeOf(() => authorize(makePrincipal({ role: "SPONSOR", schoolId: null }), "notification.preferences")), "FORBIDDEN");
  assert.equal(codeOf(() => authorize(makePrincipal({ role: "SUPER_ADMIN", schoolId: null }), "notification.preferences")), "FORBIDDEN");
  assert.equal(codeOf(() => authorize(makePrincipal({ role: "SCHOOL_ADMIN", mustChangePassword: true }), "notification.preferences")), "PASSWORD_CHANGE_REQUIRED");
});

test("productionDisabled: mode uji absensi ditolak di server produksi, tetap ada di luar produksi", () => {
  const sa = makePrincipal({ role: "SUPER_ADMIN", schoolId: null });
  const before = process.env.APP_ORIGIN;
  try {
    process.env.APP_ORIGIN = "https://studenthub.id";
    assert.equal(codeOf(() => authorize(sa, "attendance.test_mode")), "FORBIDDEN");
    assert.ok(!listAllowedActions(sa).includes("attendance.test_mode"));
    assert.equal(codeOf(() => authorize(sa, "attendance.reclose")), null, "aksi lain tidak terpengaruh");
    process.env.APP_ORIGIN = "https://staging.studenthub.id";
    assert.equal(codeOf(() => authorize(sa, "attendance.test_mode")), null);
  } finally {
    if (before === undefined) delete process.env.APP_ORIGIN; else process.env.APP_ORIGIN = before;
  }
});
