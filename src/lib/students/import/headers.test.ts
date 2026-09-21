import { test } from "node:test";
import assert from "node:assert/strict";
import { HEADER_LABELS, IMPORT_FIELDS, matchHeaders, normalizeHeader } from "./headers";

test("normalizeHeader: huruf kecil, isi kurung & tanda baca dibuang", () => {
  assert.equal(normalizeHeader("  No. HP Wali* "), "no hp wali");
  assert.equal(normalizeHeader("Jenis Kelamin (L/P)"), "jenis kelamin");
  assert.equal(normalizeHeader({ richText: [{ text: "NISN" }] }), "nisn");
  assert.equal(normalizeHeader(null), "");
});

test("semua alias dikenali", () => {
  const header = ["NISN", "nis", "Nama Lengkap", "JK", "Tempat Lahir", "Tanggal Lahir", "Alamat", "Nama Wali", "HP Wali", "Kelas", "SPP"];
  const match = matchHeaders(header, true);
  assert.deepEqual(match.missing, []);
  assert.deepEqual(match.duplicates, []);
  assert.deepEqual(match.columns, {
    nisn: 0, nis: 1, name: 2, gender: 3, birthPlace: 4, birthDate: 5, address: 6, guardianName: 7, guardianPhone: 8, className: 9, sppAmount: 10,
  });
});

test("label templat cocok dengan dirinya sendiri", () => {
  const match = matchHeaders(IMPORT_FIELDS.map((f) => HEADER_LABELS[f]), true);
  assert.deepEqual(match.missing, []);
  assert.equal(Object.keys(match.columns).length, IMPORT_FIELDS.length);
});

test("activate=true mewajibkan semua kolom aktivasi; SPP tetap opsional", () => {
  const match = matchHeaders(["NISN", "NIS", "Nama", "Jenis Kelamin"], true);
  assert.deepEqual(match.missing, ["birthPlace", "birthDate", "address", "guardianName", "guardianPhone", "className"]);
});

test("activate=false hanya mewajibkan NISN, NIS, nama, jenis kelamin", () => {
  assert.deepEqual(matchHeaders(["nisn", "nis", "nama", "jenis kelamin"], false).missing, []);
  assert.deepEqual(matchHeaders(["nisn", "nama"], false).missing, ["nis", "gender"]);
});

test("kolom tak dikenal diabaikan; kolom ganda dilaporkan", () => {
  const match = matchHeaders(["No", "NISN", "NIS", "Nama", "Nama Lengkap", "JK", "Catatan"], false);
  assert.deepEqual(match.missing, []);
  assert.deepEqual(match.duplicates, ["name"]);
  assert.equal(match.columns.nisn, 1);
});
