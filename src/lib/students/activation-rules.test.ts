import { test } from "node:test";
import assert from "node:assert/strict";
import { ageOn, getActivationGaps, newGapsAfterPatch, type ActivationInput, type GapField } from "./activation-rules";

const BASE_CLASS = { id: "class_1", schoolId: "school_1", isActive: true, academicYearId: "ay_1" } as const;

// 2026-09-21 03:00 UTC = 2026-09-21 10:00 WIB.
const NOW = new Date("2026-09-21T03:00:00.000Z");

const COMPLETE: ActivationInput = {
  name: "Budi Santoso",
  nisn: "0012345678",
  nis: "2026.001",
  gender: "MALE",
  birthPlace: "Bandung",
  birthDate: "2012-05-17",
  address: "Jl. Merdeka No. 10, Bandung",
  guardianName: "Siti Aminah",
  guardianPhone: "+6281234567890",
  classId: "class_1",
  class: BASE_CLASS,
  schoolId: "school_1",
  schoolActive: true,
  timezone: "WIB",
  activeAcademicYearId: "ay_1",
};

const with_ = (patch: Partial<ActivationInput>): ActivationInput => ({ ...COMPLETE, ...patch });
const fields = (input: ActivationInput) => getActivationGaps(input, NOW).map((g) => `${g.field}:${g.code}`);

test("data lengkap -> tanpa kekurangan", () => {
  assert.deepEqual(getActivationGaps(COMPLETE, NOW), []);
});

test("setiap field wajib yang kosong dilaporkan satu per satu", () => {
  const required: ReadonlyArray<[keyof ActivationInput, GapField]> = [
    ["name", "name"],
    ["nisn", "nisn"],
    ["nis", "nis"],
    ["gender", "gender"],
    ["birthPlace", "birthPlace"],
    ["birthDate", "birthDate"],
    ["address", "address"],
    ["guardianName", "guardianName"],
    ["guardianPhone", "guardianPhone"],
  ];
  for (const [key, field] of required) {
    assert.deepEqual(fields(with_({ [key]: null })), [`${field}:REQUIRED`], key);
  }
  assert.deepEqual(fields(with_({ classId: null, class: null })), ["currentClassId:REQUIRED"]);
});

test("semua kosong -> kekurangan berurutan sesuai formulir", () => {
  const empty = with_({
    name: null, nisn: null, nis: null, gender: null, birthPlace: null, birthDate: null,
    address: null, guardianName: null, guardianPhone: null, classId: null, class: null,
  });
  assert.deepEqual(getActivationGaps(empty, NOW).map((g) => g.field), [
    "name", "nisn", "nis", "gender", "birthPlace", "birthDate", "address", "guardianName", "guardianPhone", "currentClassId",
  ]);
});

test("setiap kekurangan membawa pesan Bahasa Indonesia", () => {
  const gaps = getActivationGaps(with_({ name: null, birthDate: null }), NOW);
  assert.ok(gaps.every((g) => g.message.length > 5));
});

test("nama 3..100 karakter", () => {
  assert.deepEqual(fields(with_({ name: "Bo" })), ["name:INVALID"]);
  assert.deepEqual(fields(with_({ name: "Ani" })), []);
  assert.deepEqual(fields(with_({ name: "a".repeat(101) })), ["name:INVALID"]);
});

test("NISN & NIS divalidasi pola", () => {
  assert.deepEqual(fields(with_({ nisn: "0000000000" })), ["nisn:INVALID"]);
  assert.deepEqual(fields(with_({ nisn: "123456789" })), ["nisn:INVALID"]);
  assert.deepEqual(fields(with_({ nis: "NIS 01" })), ["nis:INVALID"]);
  assert.deepEqual(fields(with_({ nis: "A".repeat(21) })), ["nis:INVALID"]);
});

test("alamat 10..500 karakter", () => {
  assert.deepEqual(fields(with_({ address: "Jl. Mawar" })), ["address:INVALID"]);
  assert.deepEqual(fields(with_({ address: "Jl. Mawar1" })), []);
  assert.deepEqual(fields(with_({ address: "a".repeat(501) })), ["address:INVALID"]);
});

test("tempat lahir & nama wali maks 100 karakter", () => {
  assert.deepEqual(fields(with_({ birthPlace: "a".repeat(101) })), ["birthPlace:INVALID"]);
  assert.deepEqual(fields(with_({ guardianName: "a".repeat(101) })), ["guardianName:INVALID"]);
});

test("umur 5..25 tahun pada tanggal lokal sekolah", () => {
  // Hari ini (WIB) 2026-09-21.
  assert.deepEqual(fields(with_({ birthDate: "2021-09-21" })), []);
  assert.deepEqual(fields(with_({ birthDate: "2021-09-22" })), ["birthDate:AGE_OUT_OF_RANGE"]);
  assert.deepEqual(fields(with_({ birthDate: "2000-09-22" })), []);
  assert.deepEqual(fields(with_({ birthDate: "2000-09-21" })), ["birthDate:AGE_OUT_OF_RANGE"]);
  assert.deepEqual(fields(with_({ birthDate: "2030-01-01" })), ["birthDate:AGE_OUT_OF_RANGE"]);
  assert.deepEqual(fields(with_({ birthDate: "2012-02-30" })), ["birthDate:INVALID"]);
});

test("umur dihitung dengan tanggal lokal, bukan UTC", () => {
  // 2026-09-21 18:00 UTC = 2026-09-22 01:00 WIB -> ulang tahun ke-5 sudah lewat di WIB.
  const late = new Date("2026-09-21T18:00:00.000Z");
  assert.deepEqual(getActivationGaps(with_({ birthDate: "2021-09-22" }), late), []);
  assert.equal(getActivationGaps(with_({ birthDate: "2021-09-22", timezone: "WIB" }), NOW).length, 1);
});

test("nomor HP wali tidak valid", () => {
  assert.deepEqual(fields(with_({ guardianPhone: "021555123" })), ["guardianPhone:INVALID"]);
  assert.deepEqual(fields(with_({ guardianPhone: "081234567890" })), []);
});

test("kelas: tidak ditemukan, nonaktif, sekolah lain, tahun ajaran lain", () => {
  assert.deepEqual(fields(with_({ classId: "x", class: null })), ["currentClassId:CLASS_NOT_FOUND"]);
  assert.deepEqual(fields(with_({ class: { ...BASE_CLASS, isActive: false } })), ["currentClassId:CLASS_INACTIVE"]);
  assert.deepEqual(fields(with_({ class: { ...BASE_CLASS, schoolId: "school_2" } })), ["currentClassId:CLASS_OTHER_SCHOOL"]);
  assert.deepEqual(fields(with_({ class: { ...BASE_CLASS, academicYearId: "ay_old" } })), ["currentClassId:CLASS_NOT_CURRENT_YEAR"]);
});

test("tanpa semester aktif, kelas dari tahun mana pun diterima", () => {
  assert.deepEqual(fields(with_({ activeAcademicYearId: null, class: { ...BASE_CLASS, academicYearId: "ay_old" } })), []);
});

test("sekolah nonaktif dilaporkan", () => {
  assert.deepEqual(fields(with_({ schoolActive: false })), ["school:SCHOOL_INACTIVE"]);
});

test("ageOn menghitung tahun penuh", () => {
  assert.equal(ageOn("2012-05-17", "2026-05-16"), 13);
  assert.equal(ageOn("2012-05-17", "2026-05-17"), 14);
  assert.equal(ageOn("2012-02-29", "2026-02-28"), 13);
  assert.equal(ageOn("2012-02-29", "2026-03-01"), 14);
});

test("newGapsAfterPatch: kekurangan lama pada field yang tidak disentuh diabaikan", () => {
  const before = getActivationGaps(with_({ class: { ...BASE_CLASS, academicYearId: "ay_old" } }), NOW);
  const after = getActivationGaps(with_({ class: { ...BASE_CLASS, academicYearId: "ay_old" }, address: "Jl. Baru No. 99 Bandung" }), NOW);
  assert.deepEqual(newGapsAfterPatch(before, after, new Set(["address"])), []);
});

test("newGapsAfterPatch: mengosongkan field wajib -> kekurangan baru", () => {
  const before = getActivationGaps(COMPLETE, NOW);
  const after = getActivationGaps(with_({ guardianPhone: null }), NOW);
  assert.deepEqual(
    newGapsAfterPatch(before, after, new Set(["guardianPhone"])).map((g) => g.field),
    ["guardianPhone"],
  );
});

test("newGapsAfterPatch: field yang diubah wajib bersih walau kekurangannya sama", () => {
  const oldYear = { ...BASE_CLASS, academicYearId: "ay_old" };
  const before = getActivationGaps(with_({ class: oldYear }), NOW);
  const after = getActivationGaps(with_({ classId: "class_2", class: { ...oldYear, id: "class_2" } }), NOW);
  assert.deepEqual(
    newGapsAfterPatch(before, after, new Set(["currentClassId"])).map((g) => g.code),
    ["CLASS_NOT_CURRENT_YEAR"],
  );
});
