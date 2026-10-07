import { test } from "node:test";
import assert from "node:assert/strict";
import { makePrincipal } from "@/lib/auth/test-principal";
import { resolveSchoolScope, resolveSponsorScope, studentSelf } from "./scope";

const codeOf = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "unknown";
  }
};

test("admin sekolah selalu sekolahnya sendiri", () => {
  const admin = makePrincipal({ role: "SCHOOL_ADMIN", schoolId: "A" });
  assert.equal(resolveSchoolScope(admin).schoolId, "A");
  assert.equal(resolveSchoolScope(admin, "A").schoolId, "A");
  assert.equal(codeOf(() => resolveSchoolScope(admin, "B")), "SCOPE_MISMATCH");
});

test("super admin wajib schoolId", () => {
  const sa = makePrincipal({ role: "SUPER_ADMIN", schoolId: null });
  assert.equal(codeOf(() => resolveSchoolScope(sa)), "SCHOOL_ID_REQUIRED");
  assert.equal(codeOf(() => resolveSchoolScope(sa, "  ")), "SCHOOL_ID_REQUIRED");
  assert.equal(resolveSchoolScope(sa, "B").schoolId, "B");
});

test("Admin Pemda: wajib schoolId; hanya sekolah yang diverifikasi di wilayahnya, selain itu 404", () => {
  const region = { provinceCode: "32", cityCode: null };
  const verified = makePrincipal({ role: "REGION_ADMIN", schoolId: null, region, regionSchoolId: "A" });
  assert.equal(codeOf(() => resolveSchoolScope(verified)), "SCHOOL_ID_REQUIRED");
  assert.equal(resolveSchoolScope(verified, "A").schoolId, "A");
  assert.equal(codeOf(() => resolveSchoolScope(verified, "B")), "SCHOOL_NOT_FOUND", "sekolah lain = 404, bukan 403");
  const outside = makePrincipal({ role: "REGION_ADMIN", schoolId: null, region, regionSchoolId: null });
  assert.equal(codeOf(() => resolveSchoolScope(outside, "A")), "SCHOOL_NOT_FOUND");
  assert.equal(codeOf(() => resolveSponsorScope(verified, "sp")), "FORBIDDEN");
});

test("siswa & sponsor tidak boleh memakai scope sekolah", () => {
  assert.equal(codeOf(() => resolveSchoolScope(makePrincipal({ role: "STUDENT", studentId: "st", studentStatus: "ACTIVE" }), "A")), "FORBIDDEN");
  assert.equal(codeOf(() => resolveSchoolScope(makePrincipal({ role: "SPONSOR", schoolId: null, sponsorId: "sp" }))), "FORBIDDEN");
});

test("studentSelf & resolveSponsorScope", () => {
  const st = makePrincipal({ role: "STUDENT", schoolId: "A", studentId: "st", studentStatus: "ACTIVE" });
  assert.deepEqual(studentSelf(st), { schoolId: "A", studentId: "st", userId: "user_1" });
  assert.equal(codeOf(() => studentSelf(makePrincipal())), "FORBIDDEN");
  const sp = makePrincipal({ role: "SPONSOR", schoolId: null, sponsorId: "SP1" });
  assert.equal(resolveSponsorScope(sp, "SP2").sponsorId, "SP1");
  assert.equal(codeOf(() => resolveSponsorScope(makePrincipal({ role: "SUPER_ADMIN", schoolId: null }))), "SPONSOR_ID_REQUIRED");
});
