import { test } from "node:test";
import assert from "node:assert/strict";
import { isKnownSection, isRestricted, modulesFor, resolveSection, sectionAllowed, sectionFromPath, tabItems } from "./modules";

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
