import { test } from "node:test";
import assert from "node:assert/strict";
import { FAMILY_FIELDS, FAMILY_LABELS, FAMILY_PHONE_FIELDS, OCCUPATION_SUGGESTIONS, familyOf } from "./family";

test("FAMILY_FIELDS: HP siswa, data ayah, ibu, dan pekerjaan wali — urutan formulir", () => {
  assert.deepEqual(FAMILY_FIELDS, [
    "phone", "fatherName", "fatherOccupation", "fatherPhone", "motherName", "motherOccupation", "motherPhone", "guardianOccupation",
  ]);
  assert.deepEqual(FAMILY_PHONE_FIELDS, ["phone", "fatherPhone", "motherPhone"]);
  for (const field of FAMILY_FIELDS) assert.ok(FAMILY_LABELS[field].length > 0, field);
});

test("familyOf: semua field keluarga terisi (kosong/undefined -> null), field lain diabaikan", () => {
  assert.deepEqual(familyOf({ fatherName: "Budi", motherPhone: "+6281234567890", name: "Siswa" } as never), {
    phone: null, fatherName: "Budi", fatherOccupation: null, fatherPhone: null,
    motherName: null, motherOccupation: null, motherPhone: "+6281234567890", guardianOccupation: null,
  });
  assert.deepEqual(Object.keys(familyOf({})), [...FAMILY_FIELDS]);
});

test("OCCUPATION_SUGGESTIONS: saran pekerjaan umum (Dapodik), unik", () => {
  assert.ok(OCCUPATION_SUGGESTIONS.includes("Wiraswasta"));
  assert.equal(new Set(OCCUPATION_SUGGESTIONS).size, OCCUPATION_SUGGESTIONS.length);
});
