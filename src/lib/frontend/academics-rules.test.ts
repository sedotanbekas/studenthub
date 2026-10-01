import { test } from "node:test";
import assert from "node:assert/strict";
import {
  currentYear,
  dateRangeText,
  gradeIssue,
  missingSemesters,
  preferredSemester,
  setupSteps,
  suggestTermRange,
  suggestYearName,
  suggestYearRange,
  termBounds,
  termCovering,
  termSealNotice,
  todayTermNotice,
  checklistTermNotice,
  type AcademicSnapshot,
  type YearView,
} from "./academics-rules";

const GANJIL = { id: "t1", academicYearId: "y1", semester: "GANJIL" as const, label: "Semester Ganjil 2026/2027", startDate: "2026-07-13", endDate: "2026-12-19", isActive: true };
const YEAR: YearView = { id: "y1", name: "2026/2027", startDate: "2026-07-13", endDate: "2027-06-26", terms: [GANJIL] };
const EMPTY_YEAR: YearView = { ...YEAR, terms: [] };
const CLASS = { id: "c1", academicYearId: "y1", academicYearName: "2026/2027", name: "XII TKJ 1", gradeLevel: 12, isActive: true, activeStudentCount: 30, subjectCount: 0 };
const SUBJECT = { id: "s1", code: "MTK", name: "Matematika", kkm: 75, sortOrder: 0, isActive: true };

const snapshot = (over: Partial<AcademicSnapshot> = {}): AcademicSnapshot => ({ educationLevel: "SMK", today: "2026-10-01", years: [YEAR], classes: [CLASS], subjects: [SUBJECT], ...over });

test("saran nama tahun ajaran: Juli ke atas = tahun ini/depan, sebelum Juli = tahun lalu/ini", () => {
  assert.equal(suggestYearName("2026-10-01"), "2026/2027");
  assert.equal(suggestYearName("2026-07-01"), "2026/2027");
  assert.equal(suggestYearName("2026-03-15"), "2025/2026");
});

test("saran rentang tahun ajaran dari nama: 1 Juli - 30 Juni; nama tidak sah -> null", () => {
  assert.deepEqual(suggestYearRange("2026/2027"), { startDate: "2026-07-01", endDate: "2027-06-30" });
  assert.equal(suggestYearRange("2026/2028"), null);
  assert.equal(suggestYearRange("2026"), null);
});

test("batas tanggal semester mengikuti tahun ajaran dan semester pasangannya", () => {
  assert.deepEqual(termBounds(EMPTY_YEAR, "GANJIL"), { min: "2026-07-13", max: "2027-06-26" });
  assert.deepEqual(termBounds(YEAR, "GENAP"), { min: "2026-12-20", max: "2027-06-26" }, "Genap mulai setelah Ganjil selesai");
  const withGenap: YearView = { ...EMPTY_YEAR, terms: [{ ...GANJIL, id: "t2", semester: "GENAP", startDate: "2027-01-04", endDate: "2027-06-26" }] };
  assert.deepEqual(termBounds(withGenap, "GANJIL"), { min: "2026-07-13", max: "2027-01-03" }, "Ganjil selesai sebelum Genap mulai");
});

test("saran rentang semester: Ganjil s.d. akhir Desember, Genap mulai Januari, tetap dalam batas", () => {
  assert.deepEqual(suggestTermRange(EMPTY_YEAR, "GANJIL"), { startDate: "2026-07-13", endDate: "2026-12-31" });
  assert.deepEqual(suggestTermRange(YEAR, "GENAP"), { startDate: "2027-01-01", endDate: "2027-06-26" });
});

test("semester yang belum dibuat & semester yang mencakup tanggal", () => {
  assert.deepEqual(missingSemesters(YEAR), ["GENAP"]);
  assert.deepEqual(missingSemesters(EMPTY_YEAR), ["GANJIL", "GENAP"]);
  assert.equal(termCovering([YEAR], "2026-10-01")?.id, "t1");
  assert.equal(termCovering([YEAR], "2027-02-01"), null);
});

test("tahun ajaran berjalan: yang mencakup hari ini, lalu yang akan datang terdekat, lalu yang terakhir", () => {
  const next: YearView = { ...EMPTY_YEAR, id: "y2", name: "2027/2028", startDate: "2027-07-12", endDate: "2028-06-24" };
  assert.equal(currentYear([next, YEAR], "2026-10-01")?.id, "y1");
  assert.equal(currentYear([next, YEAR], "2027-07-01")?.id, "y2", "libur kenaikan kelas -> tahun berikutnya");
  assert.equal(currentYear([YEAR], "2028-01-01")?.id, "y1");
  assert.equal(currentYear([], "2026-10-01"), null);
});

test("langkah wizard: semua lengkap -> selesai; mapel opsional", () => {
  const steps = setupSteps(snapshot({ subjects: [] }));
  assert.deepEqual(steps.map((s) => [s.key, s.status]), [["level", "done"], ["year", "done"], ["term", "done"], ["class", "done"], ["subject", "optional"]]);
  assert.equal(steps.every((s) => s.status !== "todo"), true);
});

test("langkah wizard Bina Nusa: jenjang kosong, tahun ajaran ada, semester belum ada", () => {
  const steps = setupSteps(snapshot({ educationLevel: null, years: [EMPTY_YEAR] }));
  assert.deepEqual(steps.map((s) => [s.key, s.status]), [["level", "todo"], ["year", "done"], ["term", "todo"], ["class", "done"], ["subject", "done"]]);
  assert.match(steps[2]!.why, /absen/);
});

test("semester berikutnya sudah dibuat (libur antar-semester) dihitung selesai", () => {
  const steps = setupSteps(snapshot({ today: "2026-12-28", years: [{ ...YEAR, terms: [GANJIL, { ...GANJIL, id: "t2", semester: "GENAP", startDate: "2027-01-04", endDate: "2027-06-26" }] }] }));
  assert.equal(steps.find((s) => s.key === "term")?.status, "done");
});

test("pemberitahuan semester hari ini", () => {
  assert.equal(todayTermNotice(snapshot()), null);
  assert.deepEqual(todayTermNotice(snapshot({ years: [EMPTY_YEAR] })), { tone: "warning", text: "Belum ada semester untuk hari ini, jadi siswa belum bisa absen." });
  const upcoming = todayTermNotice(snapshot({ today: "2026-12-28", years: [{ ...YEAR, terms: [GANJIL, { ...GANJIL, id: "t2", semester: "GENAP", startDate: "2027-01-04", endDate: "2027-06-26" }] }] }));
  assert.equal(upcoming?.tone, "info");
  assert.match(upcoming?.text ?? "", /4 Jan 2027/);
});

test("pemberitahuan segel: semester baru mencakup hari ini setelah absen tutup", () => {
  const now = new Date("2026-10-01T06:05:00Z"); // 13:05 WIB
  const range = { startDate: "2026-07-13", endDate: "2026-12-19" };
  assert.match(termSealNotice({ before: null, after: range, now, timezone: "WIB", checkInCloseMinute: 745 }) ?? "", /12:25/);
  assert.equal(termSealNotice({ before: null, after: range, now, timezone: "WIB", checkInCloseMinute: 900 }), null, "absen masih buka sampai 15:00");
  assert.equal(termSealNotice({ before: null, after: { startDate: "2026-10-02", endDate: "2026-12-19" }, now, timezone: "WIB", checkInCloseMinute: 745 }), null);
});

test("masalah tingkat kelas: SMK tersimpan 3 -> saran kelas 12", () => {
  assert.deepEqual(gradeIssue("SMK", { ...CLASS, gradeLevel: 3 }), { fixTo: 12, text: "Tersimpan sebagai kelas 3, padahal jenjang SMK hanya kelas 10–12. Maksudnya tingkat 3 (kelas 12)?" });
  assert.equal(gradeIssue("SMK", CLASS), null);
  assert.equal(gradeIssue(null, { ...CLASS, gradeLevel: 3 }), null);
  assert.deepEqual(gradeIssue("SMK", { ...CLASS, gradeLevel: 7 }), { fixTo: null, text: "Tersimpan sebagai kelas 7, padahal jenjang SMK hanya kelas 10–12. Ubah tingkatnya." });
});

test("teks rentang tanggal Indonesia", () => {
  assert.equal(dateRangeText("2026-07-13", "2026-12-19"), "13 Jul 2026 – 19 Des 2026");
});

test("semester yang disarankan: yang belum ada dan rentang sarannya mencakup hari ini", () => {
  assert.equal(preferredSemester(EMPTY_YEAR, "2026-10-01"), "GANJIL");
  assert.equal(preferredSemester(EMPTY_YEAR, "2027-02-01"), "GENAP");
  assert.equal(preferredSemester(YEAR, "2026-10-01"), "GENAP", "Ganjil sudah ada");
  assert.equal(preferredSemester({ ...YEAR, terms: [GANJIL, { ...GANJIL, id: "t2", semester: "GENAP" }] }, "2026-10-01"), null);
});

test("pemberitahuan Beranda dari setupChecklist profil sekolah", () => {
  assert.equal(checklistTermNotice({ hasTermToday: true, nextTermStartDate: null }), null);
  assert.deepEqual(checklistTermNotice({ hasTermToday: false, nextTermStartDate: null }), { tone: "warning", text: "Belum ada semester untuk hari ini, jadi siswa belum bisa absen." });
  assert.deepEqual(checklistTermNotice({ hasTermToday: false, nextTermStartDate: "2027-01-04" }), { tone: "info", text: "Semester berikutnya mulai 4 Jan 2027. Sampai tanggal itu siswa belum bisa absen." });
});
