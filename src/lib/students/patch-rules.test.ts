import { test } from "node:test";
import assert from "node:assert/strict";
import { canChangeNisn, diffStudentPatch, gapFieldsOf, type PatchableSnapshot } from "./patch-rules";

const CURRENT: PatchableSnapshot = {
  name: "Budi Santoso",
  nisn: "0012345678",
  nis: "N-01",
  gender: "MALE",
  birthPlace: "Bandung",
  birthDate: "2012-05-17",
  address: "Jl. Merdeka No. 10",
  guardianName: "Siti",
  guardianPhone: "+6281234567890",
  currentClassId: "c1",
  sppAmount: null,
};

test("diffStudentPatch hanya memuat field yang benar-benar berubah", () => {
  assert.deepEqual(diffStudentPatch(CURRENT, { name: "Budi Santoso", address: "Jl. Baru No. 1 Bandung" }), { address: "Jl. Baru No. 1 Bandung" });
  assert.deepEqual(diffStudentPatch(CURRENT, {}), {});
});

test("diffStudentPatch: null mengosongkan; undefined diabaikan", () => {
  assert.deepEqual(diffStudentPatch(CURRENT, { guardianPhone: null, birthPlace: undefined }), { guardianPhone: null });
  assert.deepEqual(diffStudentPatch(CURRENT, { sppAmount: 0 }), { sppAmount: 0 });
  assert.deepEqual(diffStudentPatch(CURRENT, { sppAmount: null }), {});
});

test("gapFieldsOf memetakan field patch ke field kekurangan (sppAmount tidak termasuk)", () => {
  assert.deepEqual([...gapFieldsOf({ currentClassId: "c2", sppAmount: 1, name: "X" })].sort(), ["currentClassId", "name"]);
});

test("canChangeNisn: admin sekolah hanya saat DRAFT; super admin kapan saja", () => {
  assert.equal(canChangeNisn("SCHOOL_ADMIN", "DRAFT"), true);
  for (const status of ["ACTIVE", "INACTIVE", "GRADUATED", "MOVED"] as const) {
    assert.equal(canChangeNisn("SCHOOL_ADMIN", status), false, status);
    assert.equal(canChangeNisn("SUPER_ADMIN", status), true, status);
  }
});
