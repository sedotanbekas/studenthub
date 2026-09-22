import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bannerLockKey,
  classLockKey,
  classYearLockKey,
  holidaysLockKey,
  nisnReleaseLockKey,
  subjectsLockKey,
  superAdminsLockKey,
  userLockKey,
} from "./lock-keys";

test("kunci aplikasi identik dengan string yang sudah dipakai domain (tanpa migrasi kunci)", () => {
  assert.equal(userLockKey("u1"), "auth:user:u1");
  assert.equal(classYearLockKey("y1"), "classes:y1");
  assert.equal(subjectsLockKey("s1"), "subjects:s1");
  assert.equal(holidaysLockKey("s1"), "holidays:s1");
  assert.equal(holidaysLockKey(null), "holidays:national");
  assert.equal(superAdminsLockKey(), "super-admins");
});

test("kunci baru: kelas tunggal & pelepasan NISN per sekolah", () => {
  assert.equal(classLockKey("c1"), "class:c1");
  assert.equal(nisnReleaseLockKey("s1"), "nisn-release:s1");
});

test("kunci kelas tunggal tidak bertabrakan dengan kunci daftar kelas per tahun ajaran", () => {
  assert.notEqual(classLockKey("x"), classYearLockKey("x"));
  assert.notEqual(classLockKey("x"), `class-subjects:x`);
});

test("semua kunci muat di kolom AppLock.key (<= 191) untuk id cuid", () => {
  const id = "c".repeat(30);
  const keys = [userLockKey(id), classLockKey(id), classYearLockKey(id), subjectsLockKey(id), holidaysLockKey(id), nisnReleaseLockKey(id), superAdminsLockKey()];
  for (const key of keys) assert.ok(key.length > 0 && key.length <= 191, key);
});

test("kunci banner iklan per berkas", () => {
  assert.equal(bannerLockKey("f1"), "banner:f1");
  assert.notEqual(bannerLockKey("x"), classLockKey("x"));
});
