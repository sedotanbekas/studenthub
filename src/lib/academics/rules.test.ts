import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays } from "@/lib/time/zone";
import {
  MAX_ACADEMIC_YEAR_DAYS,
  MAX_TERM_DAYS,
  findOverlappingYear,
  isValidSubjectCode,
  normalizeName,
  normalizeSubjectCode,
  parseAcademicYearName,
  termLabel,
  validateAcademicYear,
  validateTerm,
  validateYearContainsTerms,
} from "./rules";

const YEAR = { startDate: "2026-07-13", endDate: "2027-06-26" };

test("parseAcademicYearName: YYYY/YYYY+1 saja", () => {
  assert.deepEqual(parseAcademicYearName("2025/2026"), { startYear: 2025 });
  assert.equal(parseAcademicYearName("2025/2027"), null);
  assert.equal(parseAcademicYearName("2025/2025"), null);
  assert.equal(parseAcademicYearName("25/26"), null);
  assert.equal(parseAcademicYearName(" 2025/2026"), null);
  assert.equal(parseAcademicYearName("2025-2026"), null);
});

test("termLabel menurunkan label semester", () => {
  assert.equal(termLabel("GANJIL", "2025/2026"), "Semester Ganjil 2025/2026");
  assert.equal(termLabel("GENAP", "2026/2027"), "Semester Genap 2026/2027");
});

test("validateAcademicYear: rentang valid", () => {
  assert.equal(validateAcademicYear({ name: "2026/2027", ...YEAR }), null);
});

test("validateAcademicYear: tanggal terbalik / sama -> INVALID_DATE_RANGE", () => {
  assert.equal(validateAcademicYear({ name: "2026/2027", startDate: "2027-06-26", endDate: "2026-07-13" })?.code, "INVALID_DATE_RANGE");
  assert.equal(validateAcademicYear({ name: "2026/2027", startDate: "2026-07-13", endDate: "2026-07-13" })?.code, "INVALID_DATE_RANGE");
});

test("validateAcademicYear: maksimal 400 hari inklusif", () => {
  assert.equal(MAX_ACADEMIC_YEAR_DAYS, 400);
  const start = "2026-07-13";
  assert.equal(validateAcademicYear({ name: "2026/2027", startDate: start, endDate: addDays(start, 399) }), null);
  assert.equal(validateAcademicYear({ name: "2026/2027", startDate: start, endDate: addDays(start, 400) })?.code, "ACADEMIC_YEAR_TOO_LONG");
});

test("validateAcademicYear: tanggal mulai harus di tahun pertama nama", () => {
  assert.equal(validateAcademicYear({ name: "2025/2026", ...YEAR })?.code, "ACADEMIC_YEAR_NAME_MISMATCH");
  assert.equal(validateAcademicYear({ name: "2026/2028", ...YEAR })?.code, "ACADEMIC_YEAR_NAME_INVALID");
});

test("findOverlappingYear inklusif, mengabaikan dirinya sendiri lewat pemanggil", () => {
  const others = [
    { id: "a", name: "2025/2026", startDate: "2025-07-14", endDate: "2026-06-27" },
    { id: "b", name: "2027/2028", startDate: "2027-07-12", endDate: "2028-06-24" },
  ];
  assert.equal(findOverlappingYear(YEAR, others), null);
  assert.equal(findOverlappingYear({ startDate: "2026-06-27", endDate: "2027-06-26" }, others)?.id, "a");
  assert.equal(findOverlappingYear({ startDate: "2026-07-13", endDate: "2027-07-12" }, others)?.id, "b");
});

test("validateYearContainsTerms", () => {
  const terms = [{ startDate: "2026-07-13", endDate: "2026-12-19" }];
  assert.equal(validateYearContainsTerms(YEAR, terms), null);
  assert.equal(validateYearContainsTerms({ startDate: "2026-07-20", endDate: "2027-06-26" }, terms)?.code, "ACADEMIC_YEAR_EXCLUDES_TERMS");
  assert.equal(validateYearContainsTerms(YEAR, []), null);
});

test("validateTerm: di dalam tahun ajaran dan maksimal 200 hari", () => {
  assert.equal(MAX_TERM_DAYS, 200);
  assert.equal(validateTerm({ semester: "GANJIL", startDate: "2026-07-13", endDate: "2026-12-19" }, YEAR, null), null);
  assert.equal(validateTerm({ semester: "GANJIL", startDate: "2026-07-12", endDate: "2026-12-19" }, YEAR, null)?.code, "TERM_OUTSIDE_YEAR");
  assert.equal(validateTerm({ semester: "GENAP", startDate: "2027-01-04", endDate: "2027-06-27" }, YEAR, null)?.code, "TERM_OUTSIDE_YEAR");
  const start = "2026-07-13";
  assert.equal(validateTerm({ semester: "GANJIL", startDate: start, endDate: addDays(start, 199) }, YEAR, null), null);
  assert.equal(validateTerm({ semester: "GANJIL", startDate: start, endDate: addDays(start, 200) }, YEAR, null)?.code, "TERM_TOO_LONG");
  assert.equal(validateTerm({ semester: "GANJIL", startDate: "2026-12-19", endDate: "2026-12-19" }, YEAR, null)?.code, "INVALID_DATE_RANGE");
});

test("validateTerm: Ganjil harus selesai sebelum Genap dimulai", () => {
  const ganjil = { semester: "GANJIL" as const, startDate: "2026-07-13", endDate: "2026-12-19" };
  const genap = { semester: "GENAP" as const, startDate: "2027-01-04", endDate: "2027-06-26" };
  assert.equal(validateTerm(genap, YEAR, ganjil), null);
  assert.equal(validateTerm(ganjil, YEAR, genap), null);
  assert.equal(validateTerm({ ...genap, startDate: "2026-12-19" }, YEAR, ganjil)?.code, "TERM_ORDER_INVALID");
  assert.equal(validateTerm({ ...ganjil, endDate: "2027-01-04" }, YEAR, genap)?.code, "TERM_ORDER_INVALID");
  // Genap sebelum Ganjil (urutan terbalik) juga ditolak.
  assert.equal(
    validateTerm({ semester: "GENAP", startDate: "2026-07-13", endDate: "2026-12-19" }, YEAR, { semester: "GANJIL", startDate: "2027-01-04", endDate: "2027-06-26" })?.code,
    "TERM_ORDER_INVALID",
  );
});

test("kode mapel: huruf besar & pola", () => {
  assert.equal(normalizeSubjectCode("  mtk-1 "), "MTK-1");
  assert.equal(isValidSubjectCode("MTK-1"), true);
  assert.equal(isValidSubjectCode("B_INDO"), true);
  assert.equal(isValidSubjectCode("-MTK"), false);
  assert.equal(isValidSubjectCode("MTK 1"), false);
  assert.equal(isValidSubjectCode("A".repeat(20)), true);
  assert.equal(isValidSubjectCode("A".repeat(21)), false);
});

test("normalizeName merapikan spasi", () => {
  assert.equal(normalizeName("  VII   A "), "VII A");
});
