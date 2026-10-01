import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EDUCATION_LEVELS,
  educationLevelChangeViolation,
  gradeLabel,
  gradeLevelViolation,
  gradeOptions,
  gradeSpan,
  isGradeInLevel,
  nationalGrade,
  relativeGrade,
  suggestGradeFix,
} from "./education-level";

test("rentang kelas nasional per jenjang: SD/MI 1-6, SMP/MTs 7-9, SMA/MA/SMK/MAK 10-12", () => {
  assert.deepEqual(gradeSpan("SD"), { first: 1, last: 6 });
  assert.deepEqual(gradeSpan("MI"), { first: 1, last: 6 });
  assert.deepEqual(gradeSpan("SMP"), { first: 7, last: 9 });
  assert.deepEqual(gradeSpan("MTS"), { first: 7, last: 9 });
  for (const level of ["SMA", "MA", "SMK", "MAK"] as const) assert.deepEqual(gradeSpan(level), { first: 10, last: 12 });
  assert.equal(EDUCATION_LEVELS.length, 8);
});

test("tingkat relatif <-> kelas nasional saling balik", () => {
  assert.equal(relativeGrade("SMK", 12), 3);
  assert.equal(relativeGrade("SMP", 7), 1);
  assert.equal(relativeGrade("SD", 4), 4);
  assert.equal(relativeGrade("SMK", 3), null, "kelas 3 bukan bagian jenjang SMK");
  assert.equal(nationalGrade("SMK", 3), 12);
  assert.equal(nationalGrade("MTS", 2), 8);
  assert.throws(() => nationalGrade("SMA", 4), RangeError);
  for (const level of EDUCATION_LEVELS) {
    const { first, last } = gradeSpan(level);
    for (let grade = first; grade <= last; grade += 1) assert.equal(nationalGrade(level, relativeGrade(level, grade)!), grade);
  }
});

test("isGradeInLevel: jenjang kosong menerima kelas 1-12", () => {
  assert.equal(isGradeInLevel(null, 3), true);
  assert.equal(isGradeInLevel("SMK", 3), false);
  assert.equal(isGradeInLevel("SMK", 10), true);
});

test("label tingkat: relatif bila jenjang diketahui, kelas nasional bila belum", () => {
  assert.equal(gradeLabel("SMK", 12), "Tingkat 3 (kelas 12)");
  assert.equal(gradeLabel("SD", 2), "Kelas 2");
  assert.equal(gradeLabel(null, 12), "Kelas 12");
  assert.equal(gradeLabel("SMK", 3), "Kelas 3");
});

test("opsi pemilih tingkat mengikuti jenjang", () => {
  assert.deepEqual(gradeOptions("SMA"), [
    { value: 10, label: "Tingkat 1 (kelas 10)" },
    { value: 11, label: "Tingkat 2 (kelas 11)" },
    { value: 12, label: "Tingkat 3 (kelas 12)" },
  ]);
  assert.equal(gradeOptions(null).length, 12);
  assert.deepEqual(gradeOptions(null)[0], { value: 1, label: "Kelas 1" });
  assert.equal(gradeOptions("SD")[5]!.label, "Kelas 6");
});

test("saran perbaikan: tingkat relatif yang tersimpan sebagai kelas nasional", () => {
  assert.equal(suggestGradeFix("SMK", 3), 12, "SMK tingkat 3 = kelas 12");
  assert.equal(suggestGradeFix("SMP", 1), 7);
  assert.equal(suggestGradeFix("SMK", 12), null, "sudah sesuai");
  assert.equal(suggestGradeFix("SMK", 5), null, "tidak bisa ditebak");
  assert.equal(suggestGradeFix(null, 3), null);
});

test("admin sekolah hanya boleh mengisi jenjang yang masih kosong; super admin bebas", () => {
  assert.equal(educationLevelChangeViolation({ current: null, next: "SMK", isSuperAdmin: false }), null);
  assert.equal(educationLevelChangeViolation({ current: "SMK", next: "SMK", isSuperAdmin: false }), null, "tidak berubah");
  assert.equal(educationLevelChangeViolation({ current: "SMK", next: "SMA", isSuperAdmin: true }), null);
  assert.equal(educationLevelChangeViolation({ current: "SMK", next: "SMA", isSuperAdmin: false })?.code, "EDUCATION_LEVEL_LOCKED");
});

test("pelanggaran tingkat kelas menyebut jenjang dan rentangnya", () => {
  assert.equal(gradeLevelViolation(null, 3), null);
  assert.equal(gradeLevelViolation("SMK", 11), null);
  const violation = gradeLevelViolation("SMK", 3);
  assert.equal(violation?.code, "GRADE_LEVEL_OUTSIDE_EDUCATION_LEVEL");
  assert.match(violation?.message ?? "", /SMK/);
  assert.match(violation?.message ?? "", /10/);
});
