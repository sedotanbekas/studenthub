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
