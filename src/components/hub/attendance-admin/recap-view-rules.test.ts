import { test } from "node:test";
import assert from "node:assert/strict";
import type { MonthlyRecapDto } from "@/lib/attendance/monthly-recap-schemas";
import { demoMonthlyRecap } from "@/lib/frontend/demo-recap";
import {
  RECAP_LEGEND,
  canGoNextMonth,
  cellTitle,
  defaultRecapMode,
  downloadedText,
  lateReasonChips,
  otherClassBadge,
  recapNotices,
  resolveRecapClass,
  shiftRecapMonth,
  summaryLine,
  weekdayAbbr,
} from "./recap-view-rules";

const tally = (over: Partial<MonthlyRecapDto["totals"]> = {}): MonthlyRecapDto["totals"] => ({
  hadir: 596, terlambat: 14, izin: 6, sakit: 4, alpha: 2, recorded: 622, present: 610, presentPct: 98.1, lateMinutes: 186,
  lateReasons: { total: 14, filled: 9, unfilled: 5, categories: [{ category: "TRANSPORT", count: 6 }, { category: "WEATHER", count: 3 }, { category: "OVERSLEPT", count: 0 }, { category: "FAMILY", count: 0 }, { category: "HEALTH", count: 0 }, { category: "OTHER", count: 0 }] },
  ...over,
});

test("summaryLine: persen berkoma, hadir = HADIR, terlambat + menit", () => {
  assert.equal(summaryLine(tally()), "Kehadiran 98,1% · Hadir 596 · Terlambat 14 (186 menit) · Izin 6 · Sakit 4 · Alpa 2");
  assert.equal(summaryLine(tally({ presentPct: null, hadir: 0, terlambat: 0, lateMinutes: 0, izin: 0, sakit: 0, alpha: 0 })), "Kehadiran – · Hadir 0 · Terlambat 0 · Izin 0 · Sakit 0 · Alpa 0");
});

test("recapNotices: belum ada hari ditutup / data s.d. tanggal / hari belum ditutup", () => {
  const base = demoMonthlyRecap({ classId: "c0", month: "2026-09", now: new Date("2026-09-15T03:00:00Z") });
  assert.deepEqual(recapNotices(base), ["Data s.d. 14 September 2026; hari berjalan belum dihitung."]);
  assert.deepEqual(recapNotices({ ...base, closedThrough: "2026-08-31" }), ["Belum ada hari yang ditutup di bulan ini."]);
  assert.deepEqual(recapNotices({ ...base, unclosedDates: ["2026-09-07", "2026-09-08"] }), [
    "Data s.d. 14 September 2026; hari berjalan belum dihitung.",
    "2 hari belum ditutup (alpa otomatis) — angka bisa bertambah.",
  ]);
  const august = demoMonthlyRecap({ classId: "c0", month: "2026-08", now: new Date("2026-09-15T03:00:00Z") });
  assert.deepEqual(recapNotices(august), []);
});

test("bulan: geser, tidak melewati bulan berjalan", () => {
  assert.equal(shiftRecapMonth("2026-01", -1), "2025-12");
  assert.equal(canGoNextMonth("2026-09", "2026-09"), false);
  assert.equal(canGoNextMonth("2026-08", "2026-09"), true);
});

test("mode default: ringkas di bawah 760px", () => {
  assert.equal(defaultRecapMode(390), "compact");
  assert.equal(defaultRecapMode(759), "compact");
  assert.equal(defaultRecapMode(760), "grid");
});

test("resolveRecapClass: pertahankan bila ada di opsi, selain itu kelas pertama", () => {
  const options = [{ id: "a", name: "X" }, { id: "b", name: "Y" }];
  assert.equal(resolveRecapClass("b", options), "b");
  assert.equal(resolveRecapClass("lama", options), "a");
  assert.equal(resolveRecapClass("", []), "");
});

test("lencana pindah kelas & tanpa kelas; judul sel; chip alasan; teks unduhan; legenda lengkap", () => {
  assert.deepEqual(otherClassBadge([{ id: "c1", name: "XI IPA 1" }]), { text: "Pindah kelas", title: "Sebagian bulan tercatat di XI IPA 1" });
  assert.deepEqual(otherClassBadge([{ id: null, name: "Tanpa kelas" }]), { text: "Sebagian bulan tanpa kelas", title: "Sebagian bulan tercatat tanpa kelas" });
  assert.equal(otherClassBadge([]), null);
  const day = { date: "2026-08-17", day: 17, weekday: 1, reason: "HOLIDAY", holidayName: "HUT RI", closure: "CLOSED" } as const;
  assert.equal(cellTitle(day, { text: "L", tone: "holiday", final: true }), "Sen 17 Agu 2026 · Libur: HUT RI");
  assert.equal(cellTitle({ ...day, reason: "SCHOOL_DAY", holidayName: null, closure: "OPEN" }, { text: "H", tone: "pending", final: false }), "Sen 17 Agu 2026 · Hadir (hari berjalan, belum dihitung)");
  assert.deepEqual(lateReasonChips(tally()), [{ label: "Transportasi / macet", count: 6 }, { label: "Hujan / cuaca", count: 3 }, { label: "Belum diisi", count: 5 }]);
  assert.equal(downloadedText("X IPA 1", "September 2026"), "Rekap X IPA 1 September 2026 terunduh.");
  assert.equal(downloadedText(null, "September 2026"), "Rekap semua kelas September 2026 terunduh.");
  assert.deepEqual(RECAP_LEGEND.map(([code]) => code), ["H", "T", "I", "S", "A", "K", "L", "?", "–", ""]);
  assert.deepEqual([1, 2, 6, 7].map(weekdayAbbr), ["Sn", "Sl", "Sb", "Mg"], "Senin/Selasa/Sabtu tidak sama-sama 'S'");
});
