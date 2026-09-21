import { test } from "node:test";
import assert from "node:assert/strict";
import { closedThrough } from "./auto-alpha-rules";
import {
  EMPTY_COUNTS,
  aggregateByMonth,
  buildClassRates,
  buildDailyTrend,
  buildRecap,
  countsFrom,
  cutPeriod,
  deltaPp,
  pct,
  recentMonths,
  resolveRange,
  round1,
  shiftMonth,
  summarize,
  todayCard,
} from "./attendance-stats";

test("round1: satu desimal, setengah menjauhi nol, tanpa -0", () => {
  assert.equal(round1(66.66666), 66.7);
  assert.equal(round1(12.25), 12.3);
  assert.equal(round1(-2.25), -2.3);
  assert.equal(round1(100), 100);
  assert.ok(Object.is(round1(-0.04), 0));
  assert.ok(Object.is(round1(0), 0));
});

test("pct: pembagi nol -> null; 2/3 -> 66.7; 1/1 -> 100", () => {
  assert.equal(pct(0, 0), null);
  assert.equal(pct(5, 0), null);
  assert.equal(pct(2, 3), 66.7);
  assert.equal(pct(1, 1), 100);
  assert.equal(pct(0, 7), 0);
});

test("deltaPp: selisih poin persen; null bila salah satu null", () => {
  assert.equal(deltaPp(91.2, 93.5), -2.3);
  assert.equal(deltaPp(76.9, 75), 1.9);
  assert.equal(deltaPp(null, 80), null);
  assert.equal(deltaPp(80, null), null);
  assert.ok(Object.is(deltaPp(80, 80), 0));
});

test("closedThrough: hari ini setelah dayEnd lokal, kemarin sebelum dayEnd (tiga zona)", () => {
  // 08:00Z = 15:00 WIB -> tepat dayEnd 900 -> hari ini ditutup.
  assert.equal(closedThrough(new Date("2026-09-21T08:00:00Z"), "WIB", 900), "2026-09-21");
  assert.equal(closedThrough(new Date("2026-09-21T07:59:59Z"), "WIB", 900), "2026-09-20");
  // Instant yang sama di WIT (+9) = 16:59 -> sudah lewat 15:00.
  assert.equal(closedThrough(new Date("2026-09-21T07:59:59Z"), "WIT", 900), "2026-09-21");
  // WITA 23:59 lokal masih tanggal yang sama; 00:30 lokal -> tanggal baru, belum ditutup.
  assert.equal(closedThrough(new Date("2026-09-21T15:59:00Z"), "WITA", 900), "2026-09-21");
  assert.equal(closedThrough(new Date("2026-09-21T16:30:00Z"), "WITA", 900), "2026-09-21");
  // Pergantian bulan & tahun.
  assert.equal(closedThrough(new Date("2027-01-01T01:00:00Z"), "WIB", 900), "2026-12-31");
});

test("countsFrom + summarize: hadir = HADIR + TERLAMBAT, persentase atas baris tercatat", () => {
  const counts = countsFrom([
    { status: "HADIR", count: 6 },
    { status: "TERLAMBAT", count: 2 },
    { status: "IZIN", count: 1 },
    { status: "ALPHA", count: 1 },
    { status: "HADIR", count: 0 },
  ]);
  assert.deepEqual(counts, { hadir: 6, terlambat: 2, izin: 1, sakit: 0, alpha: 1 });
  assert.deepEqual(summarize(counts), {
    recorded: 10, presentPct: 80, latePct: 20, izinPct: 10, sakitPct: 0, alphaPct: 10, counts,
  });
  assert.deepEqual(summarize(EMPTY_COUNTS), {
    recorded: 0, presentPct: null, latePct: null, izinPct: null, sakitPct: null, alphaPct: null, counts: EMPTY_COUNTS,
  });
});

test("todayCard: belum absen tidak pernah negatif; hari non-sekolah -> persen null & notYet 0", () => {
  const counts = countsFrom([{ status: "HADIR", count: 3 }, { status: "TERLAMBAT", count: 1 }, { status: "SAKIT", count: 1 }]);
  assert.deepEqual(todayCard({ eligible: 8, counts, isSchoolDay: true }), {
    present: 4, late: 1, izin: 0, sakit: 1, alpha: 0, notYet: 3, presentPct: 50,
  });
  assert.equal(todayCard({ eligible: 2, counts, isSchoolDay: true }).notYet, 0);
  assert.deepEqual(todayCard({ eligible: 8, counts, isSchoolDay: false }), {
    present: 4, late: 1, izin: 0, sakit: 1, alpha: 0, notYet: 0, presentPct: null,
  });
  assert.equal(todayCard({ eligible: 0, counts: EMPTY_COUNTS, isSchoolDay: true }).presentPct, null);
});

test("shiftMonth & recentMonths melintasi batas tahun", () => {
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2026-09", -12), "2025-09");
  assert.deepEqual(recentMonths("2027-02", 4), ["2026-11", "2026-12", "2027-01", "2027-02"]);
  assert.deepEqual(recentMonths("2026-09", 1), ["2026-09"]);
});

test("aggregateByMonth: baris dikelompokkan per bulan, bulan kosong tetap muncul, di luar daftar diabaikan", () => {
  const rows = [
    { date: "2026-08-31", status: "HADIR" as const },
    { date: "2026-09-01", status: "TERLAMBAT" as const },
    { date: "2026-09-02", status: "ALPHA" as const },
    { date: "2026-07-15", status: "HADIR" as const },
  ];
  const result = aggregateByMonth(rows, ["2026-08", "2026-09", "2026-10"]);
  assert.deepEqual(result.map((m) => [m.month, m.counts]), [
    ["2026-08", { hadir: 1, terlambat: 0, izin: 0, sakit: 0, alpha: 0 }],
    ["2026-09", { hadir: 0, terlambat: 1, izin: 0, sakit: 0, alpha: 1 }],
    ["2026-10", EMPTY_COUNTS],
  ]);
});

test("cutPeriod: dipotong di closedThrough; null bila seluruh periode belum ditutup", () => {
  assert.deepEqual(cutPeriod("2026-09-01", "2026-09-30", "2026-09-20"), { from: "2026-09-01", to: "2026-09-20" });
  assert.deepEqual(cutPeriod("2026-08-01", "2026-08-31", "2026-09-20"), { from: "2026-08-01", to: "2026-08-31" });
  assert.deepEqual(cutPeriod("2026-09-01", "2026-09-30", "2026-09-01"), { from: "2026-09-01", to: "2026-09-01" });
  assert.equal(cutPeriod("2026-10-01", "2026-10-31", "2026-09-30"), null);
});

test("resolveRange: default n hari berakhir hari ini; maks 92 hari inklusif; terbalik -> null", () => {
  assert.deepEqual(resolveRange(undefined, undefined, "2026-09-21", 7), { from: "2026-09-15", to: "2026-09-21" });
  assert.deepEqual(resolveRange(undefined, "2026-09-10", "2026-09-21", 30), { from: "2026-08-12", to: "2026-09-10" });
  assert.deepEqual(resolveRange("2026-09-01", undefined, "2026-09-21", 7), { from: "2026-09-01", to: "2026-09-21" });
  assert.deepEqual(resolveRange("2026-10-01", undefined, "2026-09-21", 7), { from: "2026-10-01", to: "2026-10-01" });
  assert.deepEqual(resolveRange("2026-07-01", "2026-09-30", "2026-09-21", 7), { from: "2026-07-01", to: "2026-09-30" });
  assert.equal(resolveRange("2026-07-01", "2026-10-01", "2026-09-21", 7), null);
  assert.equal(resolveRange("2026-06-01", undefined, "2026-09-21", 7), null);
  assert.equal(resolveRange("2026-09-10", "2026-09-09", "2026-09-21", 7), null);
});

const NAMES = new Map([["kA", "VII-A"], ["kB", "VII-B"], ["k10", "X-1"]]);

test("buildRecap: eligible = tercatat + belum absen per kelas, kelas kosong di akhir, total terjumlah", () => {
  const recap = buildRecap(
    [
      { classId: "kB", status: "HADIR", count: 2 },
      { classId: "kA", status: "HADIR", count: 3 },
      { classId: "kA", status: "TERLAMBAT", count: 1 },
      { classId: null, status: "ALPHA", count: 1 },
    ],
    [{ classId: "kA", count: 2 }, { classId: "k10", count: 1 }],
    NAMES,
    true,
  );
  assert.deepEqual(recap.classes.map((c) => [c.className, c.eligible, c.notYet, c.presentPct]), [
    ["VII-A", 6, 2, 66.7],
    ["VII-B", 2, 0, 100],
    ["X-1", 1, 1, 0],
    ["Tanpa kelas", 1, 0, 0],
  ]);
  assert.deepEqual(recap.totals, { eligible: 10, hadir: 5, terlambat: 1, izin: 0, sakit: 0, alpha: 1, notYet: 3, presentPct: 60 });
  const holiday = buildRecap([{ classId: "kA", status: "HADIR", count: 1 }], [], NAMES, false);
  assert.equal(holiday.totals.presentPct, null);
  assert.equal(holiday.classes[0]?.presentPct, null);
});

test("buildClassRates: persentase per kelas snapshot + nama cadangan untuk kelas tak dikenal", () => {
  const rows = buildClassRates(
    [
      { classId: "kA", status: "HADIR", count: 4 },
      { classId: "kA", status: "SAKIT", count: 1 },
      { classId: "zz", status: "IZIN", count: 1 },
    ],
    NAMES,
  );
  assert.deepEqual(rows.map((r) => [r.classId, r.className, r.recorded, r.presentPct, r.sakitPct]), [
    ["zz", "(kelas dihapus)", 1, 0, 0],
    ["kA", "VII-A", 5, 80, 20],
  ]);
});

test("buildDailyTrend: setiap hari sekolah muncul (kosong -> null), tanggal non-sekolah bertanda", () => {
  const trend = buildDailyTrend(
    [
      { date: "2026-09-02", status: "HADIR", count: 3 },
      { date: "2026-09-02", status: "ALPHA", count: 1 },
      { date: "2026-09-05", status: "HADIR", count: 1 },
    ],
    ["2026-09-01", "2026-09-02", "2026-09-03"],
  );
  assert.deepEqual(trend.map((d) => [d.date, d.isSchoolDay, d.recorded, d.presentPct]), [
    ["2026-09-01", true, 0, null],
    ["2026-09-02", true, 4, 75],
    ["2026-09-03", true, 0, null],
    ["2026-09-05", false, 1, 100],
  ]);
});
