import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeLike, parseStatusList, parseStudentSearch } from "./search-rules";

test("escapeLike meloloskan %, _ dan backslash", () => {
  assert.equal(escapeLike("100%"), String.raw`100\%`);
  assert.equal(escapeLike("a_b"), String.raw`a\_b`);
  assert.equal(escapeLike(String.raw`c\d`), String.raw`c\\d`);
  assert.equal(escapeLike("biasa"), "biasa");
});

test("q kosong / hanya spasi -> tanpa pencarian", () => {
  assert.equal(parseStudentSearch(undefined), null);
  assert.equal(parseStudentSearch("   "), null);
});

test("q semua digit -> awalan NIS, awalan NISN, atau nama memuat", () => {
  assert.deepEqual(parseStudentSearch(" 0012 "), { nameContains: "0012", nisPrefix: "0012", nisnPrefix: "0012" });
});

test("q teks -> nama memuat atau awalan NIS (tanpa NISN)", () => {
  assert.deepEqual(parseStudentSearch("Budi  Santoso"), { nameContains: "Budi Santoso", nisPrefix: "Budi Santoso", nisnPrefix: null });
});

test("q dengan wildcard diloloskan", () => {
  assert.deepEqual(parseStudentSearch("50%_x"), { nameContains: String.raw`50\%\_x`, nisPrefix: String.raw`50\%\_x`, nisnPrefix: null });
});

test("parseStatusList: default, daftar koma, duplikat, dan token salah", () => {
  assert.deepEqual(parseStatusList(undefined), ["ACTIVE", "INACTIVE", "DRAFT"]);
  assert.deepEqual(parseStatusList("graduated, moved"), ["GRADUATED", "MOVED"]);
  assert.deepEqual(parseStatusList("ACTIVE,ACTIVE"), ["ACTIVE"]);
  assert.equal(parseStatusList("ACTIVE,LULUS"), null);
  assert.equal(parseStatusList(" , "), null);
});
