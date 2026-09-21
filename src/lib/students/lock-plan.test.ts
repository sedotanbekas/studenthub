import { test } from "node:test";
import assert from "node:assert/strict";
import { attendanceLockKey, classLockKey, nisnReleaseLockKey } from "@/lib/lock-keys";
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

test("kunci absensi siswa (bila diminta) selalu PALING HALUS: setelah kelas & kuota NISN", () => {
  assert.deepEqual(studentLockKeys({ classIds: ["c1"], claimingSchoolId: "s1", attendanceStudentId: "st1" }), [
    classLockKey("c1"),
    nisnReleaseLockKey("s1"),
    attendanceLockKey("st1"),
  ]);
  assert.deepEqual(studentLockKeys({ attendanceStudentId: "st2" }), [attendanceLockKey("st2")]);
  assert.deepEqual(studentLockKeys({ attendanceStudentId: null }), []);
});
