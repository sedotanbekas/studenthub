import { test } from "node:test";
import assert from "node:assert/strict";
import { createStudentBody, studentDetailSchema, studentProfileSchema, updateStudentBody } from "./schemas";
import { FAMILY_FIELDS } from "./family";

const BASE = { nisn: "0012345678", nis: "N-01", name: "Budi Santoso", gender: "MALE" };

test("createStudentBody: data keluarga dirapikan, nomor HP dinormalkan ke +62", () => {
  const parsed = createStudentBody.parse({
    ...BASE,
    phone: "0812-1111-2222",
    fatherName: "  Slamet   Riyadi ",
    fatherOccupation: "Wiraswasta",
    fatherPhone: "+62 813 3333 4444",
    motherName: "Siti Aminah",
    motherOccupation: "Guru/Dosen",
    motherPhone: "6281555566667",
    guardianOccupation: "",
  });
  assert.equal(parsed.phone, "+6281211112222");
  assert.equal(parsed.fatherName, "Slamet Riyadi");
  assert.equal(parsed.fatherPhone, "+6281333334444");
  assert.equal(parsed.motherPhone, "+6281555566667");
  assert.equal(parsed.guardianOccupation, null, "string kosong -> null");
});

test("createStudentBody: data keluarga opsional (boleh tidak dikirim)", () => {
  const parsed = createStudentBody.parse(BASE);
  for (const field of FAMILY_FIELDS) assert.equal(parsed[field], undefined, field);
});

test("nomor HP keluarga tidak valid -> pesan menyebut pemiliknya", () => {
  const result = createStudentBody.safeParse({ ...BASE, motherPhone: "021555123" });
  assert.equal(result.success, false);
  assert.match(result.error!.issues[0]!.message, /Nomor HP ibu tidak valid/);
  assert.deepEqual(result.error!.issues[0]!.path, ["motherPhone"]);
});

test("pekerjaan & nama orang tua maksimal 100 karakter", () => {
  const result = createStudentBody.safeParse({ ...BASE, fatherOccupation: "x".repeat(101), motherName: "y".repeat(101) });
  assert.equal(result.success, false);
  assert.deepEqual(result.error!.issues.map((i) => i.path[0]).sort(), ["fatherOccupation", "motherName"]);
});

test("updateStudentBody: null mengosongkan data keluarga; PATCH hanya data keluarga diterima", () => {
  assert.deepEqual(updateStudentBody.parse({ fatherPhone: null, motherOccupation: "Pedagang" }), { fatherPhone: null, motherOccupation: "Pedagang" });
});

test("respons detail & profil memuat data keluarga (nullable)", () => {
  for (const field of FAMILY_FIELDS) {
    assert.ok(field in studentDetailSchema.shape, `detail.${field}`);
    assert.ok(field in studentProfileSchema.shape, `profile.${field}`);
  }
  for (const field of ["address", "guardianName", "guardianPhone"]) assert.ok(field in studentProfileSchema.shape, `profile.${field}`);
});
