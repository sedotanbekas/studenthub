import { test } from "node:test";
import assert from "node:assert/strict";
import {
  invalidTargetIds,
  normalizeAudience,
  recipientFilter,
  transitionViolation,
  validateAudience,
} from "./rules";

const ids = (prefix: string, n: number): string[] => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

test("validateAudience: ALL tanpa target valid; ALL dengan target ditolak", () => {
  assert.equal(validateAudience({ audience: "ALL" }), null);
  assert.equal(validateAudience({ audience: "ALL", classIds: [], studentIds: [] }), null);
  assert.equal(validateAudience({ audience: "ALL", classIds: ["c1"] })?.field, "classIds");
  assert.equal(validateAudience({ audience: "ALL", studentIds: ["s1"] })?.field, "studentIds");
});

test("validateAudience: CLASSES wajib 1..50 kelas unik tanpa studentIds", () => {
  assert.equal(validateAudience({ audience: "CLASSES", classIds: ["c1"] }), null);
  assert.equal(validateAudience({ audience: "CLASSES" })?.field, "classIds");
  assert.equal(validateAudience({ audience: "CLASSES", classIds: [] })?.field, "classIds");
  assert.equal(validateAudience({ audience: "CLASSES", classIds: ["c1"], studentIds: ["s1"] })?.field, "studentIds");
  assert.equal(validateAudience({ audience: "CLASSES", classIds: ids("c", 50) }), null);
  assert.equal(validateAudience({ audience: "CLASSES", classIds: ids("c", 51) })?.field, "classIds");
  // Duplikat dibuang sebelum dihitung.
  assert.equal(validateAudience({ audience: "CLASSES", classIds: [...ids("c", 50), "c0", "c1"] }), null);
});

test("validateAudience: STUDENTS wajib 1..500 siswa unik tanpa classIds", () => {
  assert.equal(validateAudience({ audience: "STUDENTS", studentIds: ["s1", "s1"] }), null);
  assert.equal(validateAudience({ audience: "STUDENTS" })?.field, "studentIds");
  assert.equal(validateAudience({ audience: "STUDENTS", studentIds: ["s1"], classIds: ["c1"] })?.field, "classIds");
  assert.equal(validateAudience({ audience: "STUDENTS", studentIds: ids("s", 500) }), null);
  assert.equal(validateAudience({ audience: "STUDENTS", studentIds: ids("s", 501) })?.field, "studentIds");
});

test("validateAudience: pesan berbahasa Indonesia", () => {
  assert.match(validateAudience({ audience: "CLASSES" })?.message ?? "", /kelas/i);
});

test("normalizeAudience: buang duplikat & kosongkan daftar yang tak relevan (objek baru)", () => {
  const input = { audience: "CLASSES" as const, classIds: ["b", "a", "b"] };
  const out = normalizeAudience(input);
  assert.deepEqual(out, { audience: "CLASSES", classIds: ["b", "a"], studentIds: [] });
  assert.deepEqual(input.classIds, ["b", "a", "b"], "input tidak dimutasi");
  assert.deepEqual(normalizeAudience({ audience: "ALL", classIds: ["x"] }), { audience: "ALL", classIds: [], studentIds: [] });
  assert.deepEqual(normalizeAudience({ audience: "STUDENTS", studentIds: ["s"], classIds: ["c"] }), { audience: "STUDENTS", classIds: [], studentIds: ["s"] });
});

test("invalidTargetIds: id yang tidak ditemukan, urutan permintaan dipertahankan", () => {
  assert.deepEqual(invalidTargetIds(["a", "b", "c"], ["c", "a"]), ["b"]);
  assert.deepEqual(invalidTargetIds(["a"], ["a"]), []);
  assert.deepEqual(invalidTargetIds([], []), []);
});

test("recipientFilter: siswa AKTIF berakun aktif di sekolah, dipersempit per audiens", () => {
  const base = { schoolId: "sch", status: "ACTIVE", user: { isActive: true } };
  assert.deepEqual(recipientFilter("sch", { audience: "ALL", classIds: [], studentIds: [] }), base);
  assert.deepEqual(recipientFilter("sch", { audience: "CLASSES", classIds: ["c1"], studentIds: [] }), { ...base, currentClassId: { in: ["c1"] } });
  assert.deepEqual(recipientFilter("sch", { audience: "STUDENTS", classIds: [], studentIds: ["s1"] }), { ...base, id: { in: ["s1"] } });
});

test("transitionViolation: DRAFT boleh semua aksi", () => {
  for (const action of ["edit", "publish", "cancel", "delete"] as const) assert.equal(transitionViolation("DRAFT", action), null, action);
});

test("transitionViolation: PUBLISHED hanya boleh ditarik (cancel)", () => {
  assert.equal(transitionViolation("PUBLISHED", "cancel"), null);
  assert.deepEqual(transitionViolation("PUBLISHED", "edit")?.code, "ANNOUNCEMENT_NOT_EDITABLE");
  assert.equal(transitionViolation("PUBLISHED", "edit")?.status, 422);
  assert.deepEqual(transitionViolation("PUBLISHED", "publish")?.code, "INVALID_STATUS_TRANSITION");
  assert.equal(transitionViolation("PUBLISHED", "publish")?.status, 409);
  assert.deepEqual(transitionViolation("PUBLISHED", "delete")?.code, "ANNOUNCEMENT_NOT_DRAFT");
  assert.equal(transitionViolation("PUBLISHED", "delete")?.status, 409);
});

test("transitionViolation: CANCELLED final", () => {
  assert.equal(transitionViolation("CANCELLED", "edit")?.code, "ANNOUNCEMENT_NOT_EDITABLE");
  assert.equal(transitionViolation("CANCELLED", "publish")?.code, "INVALID_STATUS_TRANSITION");
  assert.equal(transitionViolation("CANCELLED", "cancel")?.code, "INVALID_STATUS_TRANSITION");
  assert.equal(transitionViolation("CANCELLED", "delete")?.code, "ANNOUNCEMENT_NOT_DRAFT");
});
