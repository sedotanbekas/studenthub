import assert from "node:assert/strict";
import test from "node:test";
import { IMPERSONATION_TTL_MS, impersonationExpiry, impersonationRefusal, impersonatorStillValid } from "./impersonation-rules";

const target = { id: "u1", role: "STUDENT" as const, isActive: true, schoolActive: true, studentStatus: "ACTIVE" as const };

test("impersonationRefusal: semua akun aktif selain super admin boleh dibuka", () => {
  assert.equal(impersonationRefusal(target), null);
  assert.equal(impersonationRefusal({ ...target, role: "SCHOOL_ADMIN", studentStatus: null }), null);
  assert.equal(impersonationRefusal({ ...target, role: "SPONSOR", schoolActive: null, studentStatus: null }), null);
  assert.equal(impersonationRefusal({ ...target, studentStatus: "GRADUATED" }), null, "lulus tetap bisa masuk (baca saja)");
});

test("impersonationRefusal: super admin ditolak; akun yang tidak bisa login ditolak dengan alasannya", () => {
  assert.deepEqual(impersonationRefusal({ ...target, role: "SUPER_ADMIN", schoolActive: null, studentStatus: null }), { code: "IMPERSONATION_NOT_ALLOWED" });
  assert.deepEqual(impersonationRefusal({ ...target, isActive: false }), { code: "ACCOUNT_INACTIVE", reason: "USER_INACTIVE" });
  assert.deepEqual(impersonationRefusal({ ...target, schoolActive: false }), { code: "ACCOUNT_INACTIVE", reason: "SCHOOL_INACTIVE" });
  assert.deepEqual(impersonationRefusal({ ...target, studentStatus: "DRAFT" }), { code: "ACCOUNT_INACTIVE", reason: "STUDENT_DRAFT" });
});

test("impersonationExpiry: 30 menit sejak dimulai", () => {
  const now = new Date("2026-10-05T03:00:00.000Z");
  assert.equal(IMPERSONATION_TTL_MS, 30 * 60_000);
  assert.equal(impersonationExpiry(now).toISOString(), "2026-10-05T03:30:00.000Z");
});

test("impersonatorStillValid: hanya super admin yang masih aktif", () => {
  assert.equal(impersonatorStillValid({ isActive: true, role: "SUPER_ADMIN" }), true);
  assert.equal(impersonatorStillValid({ isActive: false, role: "SUPER_ADMIN" }), false);
  assert.equal(impersonatorStillValid({ isActive: true, role: "SCHOOL_ADMIN" }), false);
  assert.equal(impersonatorStillValid(null), false);
});
