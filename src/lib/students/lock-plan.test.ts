import { test } from "node:test";
import assert from "node:assert/strict";
import { classLockKey, nisnReleaseLockKey } from "@/lib/lock-keys";
import { studentLockKeys } from "./lock-plan";

test("kunci kelas unik & id naik, lalu kunci kuota pelepasan NISN sekolah pengklaim", () => {
  assert.deepEqual(studentLockKeys({ classIds: ["c3", null, "c1", undefined, "c3", ""], claimingSchoolId: "s1" }), [
    classLockKey("c1"),
    classLockKey("c3"),
    nisnReleaseLockKey("s1"),
  ]);
});

test("tanpa kelas / tanpa klaim -> tanpa kunci", () => {
  assert.deepEqual(studentLockKeys({}), []);
  assert.deepEqual(studentLockKeys({ classIds: [null], claimingSchoolId: null }), []);
  assert.deepEqual(studentLockKeys({ claimingSchoolId: "s9" }), [nisnReleaseLockKey("s9")]);
});
