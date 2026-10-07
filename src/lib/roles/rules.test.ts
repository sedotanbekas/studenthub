import { test } from "node:test";
import assert from "node:assert/strict";
import { POLICY, authorize, listAllowedActions } from "@/lib/auth/policy";
import { makePrincipal } from "@/lib/auth/test-principal";
import { PERMISSION_CATALOG, PERMISSION_GROUPS } from "./catalog";
import {
  ALL_ACTIONS,
  ALWAYS_GRANTED,
  actionsForBase,
  assertDeletable,
  assertNotSelfLockout,
  assertRoleMatchesAccount,
  lockedActions,
  normalizePermissions,
  resolveGrants,
  roleKeyFromName,
} from "./rules";

const codeOf = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "unknown";
  }
};

test("peran sistem tanpa perubahan = persis hak bawaan POLICY jenis akunnya (deploy tidak mengubah perilaku)", () => {
  for (const base of ["SUPER_ADMIN", "SCHOOL_ADMIN", "SPONSOR", "STUDENT"] as const) {
    const grants = resolveGrants({ isSystem: true, permissions: actionsForBase(base), knownActions: ALL_ACTIONS }, base);
    assert.deepEqual([...grants].sort(), actionsForBase(base).sort(), base);
  }
});

test("aksi baru (belum dikenal peran): peran sistem ikut bawaan, peran buatan tidak", () => {
  const known = ALL_ACTIONS.filter((a) => a !== "students.import");
  const perms = actionsForBase("SCHOOL_ADMIN").filter((a) => a !== "students.import");
  assert.ok(resolveGrants({ isSystem: true, permissions: perms, knownActions: known }, "SCHOOL_ADMIN").has("students.import"));
  assert.ok(!resolveGrants({ isSystem: false, permissions: perms, knownActions: known }, "SCHOOL_ADMIN").has("students.import"));
});

test("hak dicabut dari aksi yang dikenal = tidak diberikan; hak terkunci selalu ada", () => {
  const grants = resolveGrants({ isSystem: false, permissions: [], knownActions: ALL_ACTIONS }, "SCHOOL_ADMIN");
  assert.ok(!grants.has("students.read"));
  for (const action of ["auth.self", "auth.account", "auth.email", "notification.self", "file.read"] as const) assert.ok(grants.has(action), action);
});

test("hak tidak pernah melebihi POLICY jenis akun walau dicentang", () => {
  const grants = resolveGrants({ isSystem: false, permissions: ["schools.manage", "students.read"], knownActions: ALL_ACTIONS }, "SCHOOL_ADMIN");
  assert.ok(!grants.has("schools.manage" as never));
  assert.ok(grants.has("students.read"));
});

test("data JSON rusak diperlakukan sebagai kosong", () => {
  const grants = resolveGrants({ isSystem: false, permissions: "bukan-array", knownActions: null }, "STUDENT");
  assert.deepEqual([...grants].sort(), lockedActions("STUDENT", false).sort());
});

test("normalizePermissions: tambah hak terkunci, urut POLICY, tolak aksi asing", () => {
  const out = normalizePermissions("SCHOOL_ADMIN", false, ["students.read"]);
  assert.ok(out.includes("students.read") && out.includes("auth.self"));
  assert.deepEqual(out, ALL_ACTIONS.filter((a) => out.includes(a)));
  assert.equal(codeOf(() => normalizePermissions("SCHOOL_ADMIN", false, ["schools.manage"])), "INVALID_PERMISSION");
  assert.equal(codeOf(() => normalizePermissions("STUDENT", false, ["bukan.aksi"])), "INVALID_PERMISSION");
});

test("peran sistem super admin mengunci kelola peran & pengguna (anti terkunci sendiri)", () => {
  const locked = lockedActions("SUPER_ADMIN", true);
  for (const action of ["roles.read", "roles.manage", "users.manage"] as const) assert.ok(locked.includes(action), action);
  assert.ok(!lockedActions("SUPER_ADMIN", false).includes("roles.manage"));
  assert.ok(normalizePermissions("SUPER_ADMIN", true, []).includes("roles.manage"));
  assert.ok(lockedActions("SPONSOR", true).every((a) => ALWAYS_GRANTED.has(a)));
});

test("penjaga: jenis akun cocok, peran sistem tidak dihapus, tidak mengunci diri sendiri", () => {
  assert.equal(codeOf(() => assertRoleMatchesAccount("STUDENT", "SCHOOL_ADMIN")), "ROLE_BASE_MISMATCH");
  assert.equal(codeOf(() => assertRoleMatchesAccount("STUDENT", "STUDENT")), null);
  assert.equal(codeOf(() => assertDeletable({ isSystem: true })), "SYSTEM_ROLE_LOCKED");
  assert.equal(codeOf(() => assertDeletable({ isSystem: false })), null);
  assert.equal(codeOf(() => assertNotSelfLockout(new Set(), true)), "ROLE_SELF_LOCKOUT");
  assert.equal(codeOf(() => assertNotSelfLockout(new Set(), false)), null);
  assert.equal(codeOf(() => assertNotSelfLockout(new Set(["roles.manage"] as const), true)), null);
});

test("roleKeyFromName: slug huruf kecil tanpa aksen; nama tanpa huruf/angka ditolak", () => {
  assert.equal(roleKeyFromName("  Guru Piket — Kelas X  "), "guru-piket-kelas-x");
  assert.equal(roleKeyFromName("Bendahara Sekolah"), "bendahara-sekolah");
  assert.equal(codeOf(() => roleKeyFromName("!!!")), "ROLE_NAME_INVALID");
});

test("authorize memakai grants: aksi di luar peran ditolak FORBIDDEN, tanpa grants = bawaan", () => {
  const grants = resolveGrants({ isSystem: false, permissions: ["students.read"], knownActions: ALL_ACTIONS }, "SCHOOL_ADMIN");
  const restricted = makePrincipal({ role: "SCHOOL_ADMIN", grants });
  assert.equal(codeOf(() => authorize(restricted, "students.read")), null);
  assert.equal(codeOf(() => authorize(restricted, "billing.write")), "FORBIDDEN");
  assert.ok(!listAllowedActions(restricted).includes("billing.write"));
  assert.equal(codeOf(() => authorize(makePrincipal({ role: "SCHOOL_ADMIN" }), "billing.write")), null);
});

test("katalog: setiap aksi POLICY berlabel & berkelompok sah, tanpa label untuk aksi yang tidak ada", () => {
  assert.deepEqual(Object.keys(PERMISSION_CATALOG).sort(), Object.keys(POLICY).sort());
  for (const info of Object.values(PERMISSION_CATALOG)) {
    assert.ok((PERMISSION_GROUPS as readonly string[]).includes(info.group));
    assert.ok(info.label.length > 0 && info.hint.length > 0);
  }
});
