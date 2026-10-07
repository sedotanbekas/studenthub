import { test } from "node:test";
import assert from "node:assert/strict";
import { isKnownSection, isRestricted, modulesFor, resolveSection, sectionAllowed, sectionDetailId, sectionFromPath, tabItems } from "./modules";

test("beranda selalu boleh; modul hanya untuk peran pemiliknya", () => {
  assert.equal(sectionAllowed("STUDENT", "dashboard"), true);
  assert.equal(sectionAllowed("STUDENT", "my-reports"), true);
  assert.equal(sectionAllowed("STUDENT", "attendance"), false, "halaman kehadiran admin bukan milik siswa");
  assert.equal(sectionAllowed("SCHOOL_ADMIN", "attendance"), true);
  assert.equal(sectionAllowed("SCHOOL_ADMIN", "my-attendance"), false);
  assert.equal(sectionAllowed("SPONSOR", "students"), false);
  assert.equal(sectionAllowed("SUPER_ADMIN", "students"), true);
  assert.equal(sectionAllowed("STUDENT", "tidak-ada"), false);
});

test("tema sekolah hanya untuk admin sekolah & super admin", () => {
  assert.ok(modulesFor("SCHOOL_ADMIN").some(m => m.key === "school-theme"));
  assert.ok(modulesFor("SUPER_ADMIN").some(m => m.key === "school-theme"));
  assert.equal(modulesFor("STUDENT").some(m => m.key === "school-theme"), false);
  assert.equal(modulesFor("SPONSOR").some(m => m.key === "school-theme"), false);
});

test("resolveSection: beranda, modul milik peran, modul peran lain = tidak ditemukan, akun terbatas -> keamanan", () => {
  assert.deepEqual(resolveSection("STUDENT", false, "dashboard"), { home: true, module: undefined });
  assert.equal(resolveSection("STUDENT", false, "my-reports").module?.key, "my-reports");
  assert.deepEqual(resolveSection("STUDENT", false, "attendance"), { home: false, module: undefined });
  assert.equal(resolveSection("SCHOOL_ADMIN", true, "students").module?.key, "security");
  assert.equal(resolveSection("SCHOOL_ADMIN", true, "dashboard").home, false);
});

test("tab bar HP: beranda + 3 tujuan utama per peran, semuanya modul milik peran itu", () => {
  const expected: Record<string, string[]> = {
    STUDENT: ["dashboard", "my-attendance", "my-reports", "my-billing"],
    SCHOOL_ADMIN: ["dashboard", "students", "attendance", "billing"],
    SPONSOR: ["dashboard", "campaigns", "analytics", "balance"],
    SUPER_ADMIN: ["dashboard", "schools", "users", "sponsors"],
  };
  for (const [role, keys] of Object.entries(expected)) {
    const items = tabItems(role as "STUDENT");
    assert.deepEqual(items.map(i => i.key), keys, role);
    assert.ok(items.every(i => sectionAllowed(role as "STUDENT", i.key) && i.label.length <= 10), role);
    assert.equal(items[0]!.href, "/hub");
  }
});

test("sectionDetailId: /hub/x/<id> -> id (didekode); tanpa id atau lebih dalam -> null", () => {
  assert.equal(sectionDetailId("/hub/schools/abc123"), "abc123");
  assert.equal(sectionDetailId("/hub/schools/a%20b/"), "a b");
  assert.equal(sectionDetailId("/hub/schools"), null);
  assert.equal(sectionDetailId("/hub/schools/abc/extra"), null);
  assert.equal(sectionDetailId("/hub"), null);
});

test("sectionFromPath: /hub -> beranda, /hub/x/y -> x", () => {
  assert.equal(sectionFromPath("/hub"), "dashboard");
  assert.equal(sectionFromPath("/hub/"), "dashboard");
  assert.equal(sectionFromPath("/hub/my-reports"), "my-reports");
  assert.equal(sectionFromPath("/hub/students/extra"), "students");
});

test("isKnownSection: modul peran mana pun dikenal; alamat asal-asalan tidak", () => {
  assert.equal(isKnownSection("students"), true);
  assert.equal(isKnownSection("my-billing"), true);
  assert.equal(isKnownSection("campaigns"), true);
  assert.equal(isKnownSection("dashboard"), true);
  assert.equal(isKnownSection("tidak-ada"), false);
});

test("isRestricted: wajib ganti sandi atau wajib TOTP", () => {
  const user = { mustChangePassword: false, totpEnrollmentRequired: false };
  assert.equal(isRestricted({ user }), false);
  assert.equal(isRestricted({ user: { ...user, mustChangePassword: true } }), true);
  assert.equal(isRestricted({ user: { ...user, totpEnrollmentRequired: true } }), true);
});

test("RBAC: aksi tiap modul = aksi operasi utamanya di katalog API (menu tersaring hak peran akses)", async () => {
  const { MODULE_ACTIONS } = await import("./modules");
  const { operations } = await import("./catalog");
  for (const role of ["SCHOOL_ADMIN", "SUPER_ADMIN", "SPONSOR", "STUDENT"] as const) {
    for (const m of modulesFor(role)) {
      const op = operations.find(o => o.id === m.primary);
      assert.ok(op, `${m.key}: operasi ${m.primary}`);
      assert.equal(MODULE_ACTIONS[m.key], op.action, m.key);
    }
  }
});

test("RBAC: modul tanpa hak tersembunyi; daftar hak kosong (persona demo) = semua modul", () => {
  const limited = ["auth.self", "notification.self", "students.read"];
  assert.deepEqual(modulesFor("SCHOOL_ADMIN", limited).map(m => m.key), ["students", "notifications", "security"]);
  assert.equal(sectionAllowed("SCHOOL_ADMIN", "billing", limited), false);
  assert.equal(sectionAllowed("SCHOOL_ADMIN", "students", limited), true);
  assert.deepEqual(tabItems("SCHOOL_ADMIN", limited).map(t => t.key), ["dashboard", "students"]);
  assert.equal(modulesFor("SCHOOL_ADMIN", []).length, modulesFor("SCHOOL_ADMIN").length);
  assert.equal(resolveSection("SCHOOL_ADMIN", true, "billing", limited).module?.key, "security");
  assert.ok(modulesFor("SUPER_ADMIN").some(m => m.key === "access-roles"));
  assert.equal(modulesFor("SCHOOL_ADMIN").some(m => m.key === "access-roles"), false);
});
