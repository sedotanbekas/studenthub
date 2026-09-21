import { test } from "node:test";
import assert from "node:assert/strict";
import { BCRYPT_COST, TEMP_PASSWORD_BCRYPT_COST, TEMP_PASSWORD_TTL_MS } from "@/lib/auth/password";
import {
  assertCreatableRole,
  assertEditableTarget,
  assertNotLastSuperAdmin,
  assertResetTarget,
  assertSessionTarget,
  assertStatusTarget,
  planCredential,
} from "./rules";

const codeOf = (fn: () => unknown): { status: number; code: string } | null => {
  try {
    fn();
    return null;
  } catch (error) {
    const e = error as { status?: number; code?: string };
    return { status: e.status ?? 0, code: e.code ?? "unknown" };
  }
};

const ACTOR = "actor-1";
const NOW = new Date("2026-09-21T03:00:00.000Z");

test("pembuatan user: hanya SCHOOL_ADMIN (wajib schoolId) dan SUPER_ADMIN (tanpa schoolId)", () => {
  assert.equal(codeOf(() => assertCreatableRole("SCHOOL_ADMIN", "school-1")), null);
  assert.equal(codeOf(() => assertCreatableRole("SUPER_ADMIN", undefined)), null);
  assert.deepEqual(codeOf(() => assertCreatableRole("SCHOOL_ADMIN", undefined)), { status: 400, code: "SCHOOL_ID_REQUIRED" });
  assert.deepEqual(codeOf(() => assertCreatableRole("SUPER_ADMIN", "school-1")), { status: 400, code: "SCHOOL_ID_NOT_ALLOWED" });
  assert.deepEqual(codeOf(() => assertCreatableRole("SPONSOR", undefined)), { status: 400, code: "USE_DEDICATED_ENDPOINT" });
  assert.deepEqual(codeOf(() => assertCreatableRole("STUDENT", "school-1")), { status: 400, code: "USE_DEDICATED_ENDPOINT" });
});

test("nonaktif/aktifkan: siswa lewat status siswa, tidak boleh diri sendiri", () => {
  assert.equal(codeOf(() => assertStatusTarget(ACTOR, { id: "u2", role: "SCHOOL_ADMIN" })), null);
  assert.equal(codeOf(() => assertStatusTarget(ACTOR, { id: "u2", role: "SPONSOR" })), null);
  assert.deepEqual(codeOf(() => assertStatusTarget(ACTOR, { id: "u2", role: "STUDENT" })), { status: 400, code: "USE_STUDENT_STATUS" });
  assert.deepEqual(codeOf(() => assertStatusTarget(ACTOR, { id: ACTOR, role: "SUPER_ADMIN" })), { status: 400, code: "CANNOT_TARGET_SELF" });
});

test("reset password: siswa lewat endpoint siswa, diri sendiri lewat ganti password", () => {
  assert.equal(codeOf(() => assertResetTarget(ACTOR, { id: "u2", role: "SUPER_ADMIN" })), null);
  assert.deepEqual(codeOf(() => assertResetTarget(ACTOR, { id: "u2", role: "STUDENT" })), { status: 400, code: "USE_STUDENT_ENDPOINT" });
  assert.deepEqual(codeOf(() => assertResetTarget(ACTOR, { id: ACTOR, role: "SUPER_ADMIN" })), { status: 400, code: "USE_CHANGE_PASSWORD" });
});

test("cabut sesi & ubah profil", () => {
  assert.equal(codeOf(() => assertSessionTarget(ACTOR, { id: "u2", role: "STUDENT" })), null);
  assert.deepEqual(codeOf(() => assertSessionTarget(ACTOR, { id: ACTOR, role: "SUPER_ADMIN" })), { status: 400, code: "CANNOT_TARGET_SELF" });
  assert.equal(codeOf(() => assertEditableTarget({ id: "u2", role: "SPONSOR" })), null);
  assert.deepEqual(codeOf(() => assertEditableTarget({ id: "u2", role: "STUDENT" })), { status: 400, code: "USE_STUDENT_ENDPOINT" });
});

test("super admin aktif terakhir tidak boleh dinonaktifkan", () => {
  assert.deepEqual(codeOf(() => assertNotLastSuperAdmin({ role: "SUPER_ADMIN", isActive: true }, 0)), { status: 409, code: "LAST_SUPER_ADMIN" });
  assert.equal(codeOf(() => assertNotLastSuperAdmin({ role: "SUPER_ADMIN", isActive: true }, 1)), null);
  assert.equal(codeOf(() => assertNotLastSuperAdmin({ role: "SUPER_ADMIN", isActive: false }, 0)), null);
  assert.equal(codeOf(() => assertNotLastSuperAdmin({ role: "SCHOOL_ADMIN", isActive: true }, 0)), null);
});

test("kata sandi diketik: dicek kebijakan, cost 10, tanpa kedaluwarsa", () => {
  const plan = planCredential("KuatSekali99", { email: "budi@sekolah.id" }, NOW);
  assert.deepEqual(plan, { kind: "TYPED", plain: "KuatSekali99", cost: BCRYPT_COST, tempPasswordExpiresAt: null });
});

test("kata sandi diketik yang lemah -> 422 dengan daftar pelanggaran", () => {
  try {
    planCredential("budi1234x", { email: "budi@sekolah.id" }, NOW);
    assert.fail("harus melempar");
  } catch (error) {
    const e = error as { status: number; code: string; details: { violations: string[]; messages: string[] } };
    assert.equal(e.status, 422);
    assert.equal(e.code, "PASSWORD_POLICY");
    assert.deepEqual(e.details.violations, ["CONTAINS_PERSONAL_DATA"]);
    assert.equal(e.details.messages.length, 1);
  }
  assert.deepEqual(codeOf(() => planCredential("pendek1", {}, NOW)), { status: 422, code: "PASSWORD_POLICY" });
});

test("tanpa kata sandi: generate sementara cost 8, kedaluwarsa 14 hari", () => {
  const plan = planCredential(undefined, {}, NOW, () => "abcde23456");
  assert.equal(plan.kind, "GENERATED");
  assert.equal(plan.plain, "abcde23456");
  assert.equal(plan.cost, TEMP_PASSWORD_BCRYPT_COST);
  assert.equal(plan.tempPasswordExpiresAt?.getTime(), NOW.getTime() + TEMP_PASSWORD_TTL_MS);
  const real = planCredential(undefined, {}, NOW);
  assert.equal(real.plain.length, 10);
});
