import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { DayCheck } from "@/lib/calendar/rules";
import { sumTallies, tallyAttendance } from "./attendance-stats";
import {
  RECAP_TONE_COLORS,
  buildClassRecap,
  buildRecapDays,
  cellDisplay,
  recapClassKeys,
  recapFileName,
  sheetNameFor,
  type MonthlyRecapCandidate,
  type MonthlyRecapDay,
  type MonthlyRecapRow,
} from "./monthly-recap-rules";

const school = (date: string): DayCheck => ({ date, isSchoolDay: true, reason: "SCHOOL_DAY", holidayName: null });

test("buildRecapDays: nomor tanggal, hari (1=Sen..7=Min), status penutupan CLOSED / UNCLOSED / OPEN", () => {
  const days = buildRecapDays(
    [school("2026-09-01"), school("2026-09-02"), { date: "2026-09-03", isSchoolDay: false, reason: "HOLIDAY", holidayName: "Maulid" }, school("2026-09-04"), { date: "2026-09-06", isSchoolDay: false, reason: "DAY_OFF", holidayName: null }],
    "2026-09-03",
    ["2026-09-02"],
  );
  assert.deepEqual(days.map((d) => [d.day, d.weekday, d.reason, d.closure]), [
    [1, 2, "SCHOOL_DAY", "CLOSED"],
    [2, 3, "SCHOOL_DAY", "UNCLOSED"],
    [3, 4, "HOLIDAY", "CLOSED"],
    [4, 5, "SCHOOL_DAY", "OPEN"],
    [6, 7, "DAY_OFF", "OPEN"],
  ]);
  assert.equal(days[2]?.holidayName, "Maulid");
});

// Kelas X, 4 hari: 1-2 tertutup (2 = belum ditutup), 3-4 berjalan (OPEN).
const DAYS: MonthlyRecapDay[] = buildRecapDays(["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"].map(school), "2026-09-02", ["2026-09-02"]);
const candidate = (id: string, name: string, nis: string, currentClassId: string | null, isCurrentEligible = true): MonthlyRecapCandidate => ({
  id, name, nis, status: "ACTIVE", currentClassId, isCurrentEligible,
});
const row = (studentId: string, day: number, classId: string | null, status: MonthlyRecapRow["status"] = "HADIR", extra: Partial<MonthlyRecapRow> = {}): MonthlyRecapRow => ({
  studentId, date: `2026-09-0${day}`, classId, status, source: "CHECKIN", lateMinutes: status === "TERLAMBAT" ? 10 : null, lateReason: null, ...extra,
});

test("buildClassRecap: keanggotaan (snapshot kelas + anggota layak tanpa baris), sel K, OPEN tampil tapi tidak dihitung", () => {
  const candidates = [
    candidate("ani", "Ani", "001", "X"),
    candidate("budi2", "budi", "003", "X"),
    candidate("budi1", "Budi", "002", "X"),
    candidate("pindah", "Citra", "004", "X"),
    candidate("keluar", "Dedi", "005", "Y"),
    candidate("diY", "Eka", "006", "X"),
    candidate("baru", "Fajar", "007", "X", false),
    candidate("tanpa", "Gita", "008", null),
  ];
  const rows = [
    row("ani", 1, "X"), row("ani", 2, "X", "TERLAMBAT", { lateReason: "WEATHER" }), row("ani", 3, "X", "TERLAMBAT"),
    row("pindah", 1, "Y"), row("pindah", 2, null, "IZIN"), row("pindah", 3, "X"),
    row("keluar", 1, "X", "ALPHA"),
    row("diY", 1, "Y"),
    row("tanpa", 1, null),
  ];
  const recap = buildClassRecap({ classKey: "X", days: DAYS, closedThrough: "2026-09-02", candidates, rows });
  assert.deepEqual(recap.students.map((s) => [s.studentId, s.cells]), [
    ["ani", ["H", "T", "T", null]],
    ["budi1", [null, null, null, null]],
    ["budi2", [null, null, null, null]],
    ["pindah", ["K", "K", "H", null]],
    ["keluar", ["A", null, null, null]],
  ], "urut nama (tanpa beda huruf besar) lalu NIS; Eka (baris hanya di kelas lain) & Fajar (belum layak) tidak ikut");
  const ani = recap.students[0]!;
  assert.deepEqual([ani.totals.recorded, ani.totals.counts.terlambat, ani.totals.lateMinutes, ani.totals.lateReasons.filled], [2, 1, 10, 1], "hari 3 (OPEN) tidak dihitung; hari 2 (UNCLOSED) dihitung");
  const pindah = recap.students[3]!;
  assert.deepEqual(pindah.otherClassIds, ["Y", null]);
  assert.equal(pindah.totals.recorded, 0, "baris di kelas lain tidak dihitung di kelas ini");
  assert.deepEqual(recap.totals, sumTallies(recap.students.map((s) => s.totals)));
  assert.deepEqual(recap.totals.counts, tallyAttendance([{ status: "HADIR" }, { status: "TERLAMBAT" }, { status: "ALPHA" }]).counts);

  const none = buildClassRecap({ classKey: null, days: DAYS, closedThrough: "2026-09-02", candidates, rows });
  assert.deepEqual(none.students.map((s) => [s.studentId, s.cells]), [["pindah", ["K", "I", "K", null]], ["tanpa", ["H", null, null, null]]]);
});

test("recapClassKeys: kelas dari baris & anggota layak tanpa baris (aturan keanggotaan), urut nama numerik, tanpa kelas terakhir", () => {
  const names = new Map([["X", "X IPA 10"], ["Y", "X IPA 2"], ["Z", "XI IPA 1"], ["W", "XII"]]);
  const keys = recapClassKeys(
    [candidate("a", "A", "1", "W"), candidate("b", "B", "2", "X"), candidate("c", "C", "3", "W", false), candidate("d", "D", "4", "Z")],
    [row("a", 1, "Y"), row("b", 1, null), row("b", 2, "X")],
    names,
  );
  assert.deepEqual(keys, ["Y", "X", "Z", null]);
});

test("cellDisplay: urutan aturan — kode (OPEN abu-abu; K; UNCLOSED tetap final) lalu kosong (libur, non-sekolah, OPEN, ?, –)", () => {
  const day = (closure: MonthlyRecapDay["closure"], reason: MonthlyRecapDay["reason"] = "SCHOOL_DAY"): MonthlyRecapDay => ({ date: "2026-09-01", day: 1, weekday: 2, reason, holidayName: null, closure });
  assert.deepEqual(cellDisplay(day("OPEN"), "H"), { text: "H", tone: "pending", final: false });
  assert.deepEqual(cellDisplay(day("OPEN"), "K"), { text: "K", tone: "pending", final: false });
  assert.deepEqual(cellDisplay(day("CLOSED"), "K"), { text: "K", tone: "other", final: true });
  assert.deepEqual(cellDisplay(day("UNCLOSED"), "H"), { text: "H", tone: "hadir", final: true });
  assert.deepEqual(cellDisplay(day("CLOSED"), "A"), { text: "A", tone: "alpha", final: true });
  assert.deepEqual(cellDisplay(day("CLOSED", "HOLIDAY"), "H"), { text: "H", tone: "hadir", final: true }, "baris menang atas libur");
  assert.deepEqual(cellDisplay(day("OPEN", "HOLIDAY"), null), { text: "L", tone: "holiday", final: true });
  assert.deepEqual(cellDisplay(day("CLOSED", "DAY_OFF"), null), { text: "", tone: "off", final: true });
  assert.deepEqual(cellDisplay(day("OPEN", "OUTSIDE_TERM"), null), { text: "", tone: "off", final: true });
  assert.deepEqual(cellDisplay(day("OPEN"), null), { text: "", tone: "pending", final: false });
  assert.deepEqual(cellDisplay(day("UNCLOSED"), null), { text: "?", tone: "unclosed", final: false });
  assert.deepEqual(cellDisplay(day("CLOSED"), null), { text: "–", tone: "none", final: true });
});

test("sheetNameFor: karakter terlarang, kutip tepi, 31 karakter, nama cadangan & duplikat tanpa beda huruf", () => {
  const used = new Set<string>();
  assert.equal(sheetNameFor("X IPA 1", used), "X IPA 1");
  assert.equal(sheetNameFor("x ipa 1", new Set(["x ipa 1"])), "x ipa 1 (2)");
  assert.equal(sheetNameFor("x ipa 1", new Set(["x ipa 1", "x ipa 1 (2)"])), "x ipa 1 (3)");
  assert.equal(sheetNameFor("Kelas: A/B? [*]\\", used), "Kelas AB");
  assert.equal(sheetNameFor("'Kelas A'", used), "Kelas A");
  assert.equal(sheetNameFor("***", used), "Kelas");
  assert.equal(sheetNameFor("Keterangan", used), "Keterangan (2)");
  assert.equal(sheetNameFor("HISTORY", used), "HISTORY (2)");
  const long = "Kelas Unggulan Sains dan Teknologi Terapan";
  assert.equal(sheetNameFor(long, used), long.slice(0, 31).trim());
  const dup = sheetNameFor(long, new Set([long.slice(0, 31).trim().toLowerCase()]));
  assert.equal(dup.length <= 31, true);
  assert.match(dup, / \(2\)$/);
});

test("recapFileName: slug ASCII, semua kelas, cadangan 'kelas'", () => {
  assert.equal(recapFileName("2026-09", "X IPA 1"), "rekap-kehadiran-x-ipa-1-2026-09.xlsx");
  assert.equal(recapFileName("2026-09", "XI-IPA 2 (Unggulan)"), "rekap-kehadiran-xi-ipa-2-unggulan-2026-09.xlsx");
  assert.equal(recapFileName("2026-09", "Kelas Ánggrek"), "rekap-kehadiran-kelas-anggrek-2026-09.xlsx");
  assert.equal(recapFileName("2026-09", "صف"), "rekap-kehadiran-kelas-2026-09.xlsx");
  assert.equal(recapFileName("2026-09", null), "rekap-kehadiran-semua-kelas-2026-09.xlsx");
});

test("RECAP_TONE_COLORS sama dengan token --att-*-soft / --att-*-ink di charts.css", () => {
  const css = readFileSync("src/styles/charts.css", "utf8");
  const token = (name: string) => new RegExp(`--att-${name}:\\s*(#[0-9a-f]{6})`, "i").exec(css)?.[1]?.toLowerCase();
  for (const [tone, colors] of Object.entries(RECAP_TONE_COLORS)) {
    assert.equal(colors.fill, token(`${tone}-soft`), `${tone} fill`);
    assert.equal(colors.ink, token(`${tone}-ink`), `${tone} ink`);
  }
});
