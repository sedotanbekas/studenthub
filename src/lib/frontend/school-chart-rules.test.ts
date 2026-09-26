import { test } from "node:test";
import assert from "node:assert/strict";
import type { ClassAnalyticsDto, SchoolTrendDto } from "@/lib/attendance/monitor-schemas";
import {
  ATTENTION_PCT,
  classDetail,
  classRows,
  compactDate,
  countAxisLabel,
  isClassAnalytics,
  isSchoolTrend,
  isSummaryAnalytics,
  lastDays,
  monthMix,
  monthName,
  monthOf,
  monthTileNote,
  pctText,
  schoolToday,
  splitClasses,
  todayCaption,
  todaySegments,
  trendDays,
  trendFooterText,
  trendHighlights,
  trendRange,
  trendSeries,
} from "./school-chart-rules";

const counts = (hadir: number, terlambat: number, izin = 0, sakit = 0, alpha = 0) => ({ hadir, terlambat, izin, sakit, alpha });
const rate = (c: ReturnType<typeof counts>, presentPct: number | null) => {
  const recorded = c.hadir + c.terlambat + c.izin + c.sakit + c.alpha;
  return { recorded, presentPct, latePct: recorded ? Math.round((c.terlambat / recorded) * 1000) / 10 : null, izinPct: null, sakitPct: null, alphaPct: recorded ? Math.round((c.alpha / recorded) * 1000) / 10 : null, counts: c };
};

test("schoolToday memakai zona sekolah; zona tak dikenal -> WIB", () => {
  const now = new Date("2026-09-25T17:30:00Z"); // 00:30 WIB 26 Sep, 01:30 WITA, 02:30 WIT
  assert.equal(schoolToday("WIB", now), "2026-09-26");
  assert.equal(schoolToday("WIT", now), "2026-09-26");
  assert.equal(schoolToday(undefined, new Date("2026-09-25T16:30:00Z")), "2026-09-25");
  assert.equal(schoolToday("PST", new Date("2026-09-25T16:30:00Z")), "2026-09-25", "zona asing jatuh ke WIB");
});

test("trendRange: n hari terakhir berakhir kemarin (hari ini belum ditutup)", () => {
  assert.deepEqual(trendRange(30, "2026-09-26"), { from: "2026-08-27", to: "2026-09-25" });
  assert.deepEqual(trendRange(14, "2026-09-26"), { from: "2026-09-12", to: "2026-09-25" });
  assert.deepEqual(trendRange(14, "2026-03-01"), { from: "2026-02-15", to: "2026-02-28" });
});

test("monthOf & monthName", () => {
  assert.equal(monthOf("2026-09-26"), "2026-09");
  assert.equal(monthName("2026-08"), "Agustus");
  assert.equal(monthName("2026-13"), "2026-13", "bulan tak valid dikembalikan apa adanya");
});

test("pctText satu desimal gaya Indonesia; null -> tanda pisah", () => {
  assert.equal(pctText(93.4), "93,4%");
  assert.equal(pctText(96), "96,0%");
  assert.equal(pctText(null), "—");
});

const trendDto: SchoolTrendDto = {
  from: "2026-09-18",
  to: "2026-09-23",
  closedThrough: "2026-09-22",
  days: [
    { date: "2026-09-18", isSchoolDay: true, ...rate(counts(90, 4, 2, 1, 3), 94) },
    // 19 & 20 (akhir pekan) tidak dikirim server: bukan hari sekolah.
    { date: "2026-09-21", isSchoolDay: true, ...rate(counts(0, 0), null) },
    { date: "2026-09-22", isSchoolDay: true, ...rate(counts(95, 2, 1, 1, 1), 97) },
  ],
};

test("trendDays mengisi sumbu tanggal penuh: hari tak dikirim = bukan hari sekolah, setelah closedThrough = belum ditutup", () => {
  const days = trendDays(trendDto);
  assert.deepEqual(days.map(d => d.date), ["2026-09-18", "2026-09-19", "2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23"]);
  assert.deepEqual(days.map(d => d.isSchoolDay), [true, false, false, true, true, false]);
  assert.deepEqual(days.map(d => d.isClosed), [true, true, true, true, true, false]);
  assert.equal(days[0]?.presentPct, 94);
  assert.equal(days[1]?.counts, null);
  assert.equal(days[5]?.counts, null, "hari belum ditutup tanpa data");
});

test("trendSeries: lima status berurutan, hari non-sekolah & tanpa catatan = kolom kosong (null)", () => {
  const series = trendSeries(trendDays(trendDto));
  assert.deepEqual(series.map(s => s.key), ["hadir", "terlambat", "izin", "sakit", "alpha"]);
  assert.deepEqual(series.map(s => s.label), ["Hadir", "Terlambat", "Izin", "Sakit", "Alpa"]);
  assert.equal(series[0]?.color, "var(--att-hadir)");
  assert.deepEqual(series[0]?.values, [90, null, null, null, 95, null]);
  assert.deepEqual(series[4]?.values, [3, null, null, null, 1, null]);
});

test("trendSeries fokus 'selain hadir' membuang seri Hadir agar skala memperbesar yang tidak hadir", () => {
  const series = trendSeries(trendDays(trendDto), "absent");
  assert.deepEqual(series.map(s => s.key), ["terlambat", "izin", "sakit", "alpha"]);
  assert.deepEqual(series[0]?.values, [4, null, null, null, 2, null]);
});

test("countAxisLabel: sumbu jumlah siswa hanya memberi label garis bilangan bulat", () => {
  assert.equal(countAxisLabel(0), "0");
  assert.equal(countAxisLabel(75), "75");
  assert.equal(countAxisLabel(1500), "1.500");
  assert.equal(countAxisLabel(37.5), "", "tidak ada '37,5 siswa'");
});

test("compactDate: label sumbu ringkas untuk layar sempit", () => {
  assert.equal(compactDate("2026-08-27"), "27/8");
  assert.equal(compactDate("2026-09-01"), "1/9");
});

test("monthMix: komposisi selain hadir tepat waktu bulan ini, persen null -> 0", () => {
  const mix = monthMix({ latePct: 2.1, izinPct: 1.9, sakitPct: null, alphaPct: 1.4 });
  assert.deepEqual(mix.map(m => m.label), ["Terlambat", "Izin", "Sakit", "Alpa"]);
  assert.deepEqual(mix.map(m => m.text), ["2,1%", "1,9%", "0,0%", "1,4%"]);
  assert.equal(mix[3]?.color, "var(--att-alpha)");
});

test("lastDays memotong n hari terakhir", () => {
  const days = trendDays(trendDto);
  assert.deepEqual(lastDays(days, 2).map(d => d.date), ["2026-09-22", "2026-09-23"]);
  assert.equal(lastDays(days, 30).length, 6);
});

test("trendFooterText menjelaskan tiap kolom", () => {
  const days = trendDays(trendDto);
  assert.equal(trendFooterText(days[0]), "Hadir tepat waktu + terlambat: 94,0%");
  assert.equal(trendFooterText(days[1]), "Bukan hari sekolah");
  assert.equal(trendFooterText(days[3]), "Belum ada catatan absensi");
  assert.equal(trendFooterText(days[5]), "Belum ditutup — data masuk setelah jam absensi berakhir");
  assert.equal(trendFooterText(undefined), "");
});

test("trendHighlights: rata-rata berbobot catatan (seperti server) dan hari terendah", () => {
  const h = trendHighlights(trendDays(trendDto));
  assert.equal(h.schoolDays, 2, "hanya hari sekolah bercatatan");
  assert.equal(h.averagePct, 95.5, "(94 + 97) hadir / (100 + 100) catatan");
  assert.equal(h.lowest?.date, "2026-09-18");
  assert.deepEqual(trendHighlights([]), { averagePct: null, lowest: null, schoolDays: 0 });
});

test("trendHighlights: 'Hari sekolah' hanya menghitung isSchoolDay=true (hari lain yang bercatatan tidak ikut)", () => {
  const withEvent: SchoolTrendDto = { ...trendDto, days: [...trendDto.days, { date: "2026-09-19", isSchoolDay: false, ...rate(counts(40, 0), 100) }] };
  const days = trendDays(withEvent);
  assert.equal(days[1]?.counts?.hadir, 40, "kegiatan akhir pekan tetap tampil di grafik");
  assert.equal(trendHighlights(days).schoolDays, 2);
});

const classDto = (rows: Array<[string, number | null, number]>): ClassAnalyticsDto["classes"] =>
  rows.map(([name, pct, recorded], i) => ({ classId: `c${i}`, className: name, recorded, presentPct: pct, latePct: 3.1, izinPct: 1, sakitPct: 1, alphaPct: 0.8, counts: counts(recorded, 0) }));

test("classRows: persen hadir terendah dulu, tanpa catatan di akhir, penanda perhatian < 90%", () => {
  const rows = classRows(classDto([["XII IPA 1", 97.1, 400], ["XI IPS 2", 87.6, 380], ["X IPA 1", 93.4, 412], ["X IPA 2", null, 0], ["XI IPA 1", 93.4, 390]]));
  assert.deepEqual(rows.map(r => r.label), ["XI IPS 2", "X IPA 1", "XI IPA 1", "XII IPA 1", "X IPA 2"]);
  assert.deepEqual(rows.map(r => r.attention), [true, false, false, false, false]);
  assert.equal(rows[0]?.valueText, "87,6%");
  assert.equal(rows[4]?.valueText, "—");
  assert.equal(rows[4]?.value, 0);
  assert.equal(ATTENTION_PCT, 90);
  assert.equal(classRows(classDto([["A", 90, 10]]))[0]?.attention, false, "tepat 90% tidak ditandai");
});

test("classDetail merangkum terlambat, alpa, dan jumlah catatan", () => {
  assert.equal(classDetail({ latePct: 3.1, alphaPct: 0.8, recorded: 412 }), "Terlambat 3,1% · Alpa 0,8% · 412 catatan");
  assert.equal(classDetail({ latePct: null, alphaPct: null, recorded: 0 }), "Belum ada catatan bulan ini");
  assert.equal(classDetail({ latePct: 1, alphaPct: 0, recorded: 1284 }), "Terlambat 1,0% · Alpa 0,0% · 1.284 catatan");
});

test("splitClasses: kelas perlu perhatian selalu tampil; sisanya dibatasi sampai dibuka", () => {
  const rows = classRows(classDto([["A", 80, 1], ["B", 91, 1], ["C", 92, 1], ["D", 93, 1], ["E", 94, 1], ["F", 95, 1], ["G", 96, 1], ["H", 97, 1]]));
  const collapsed = splitClasses(rows, 6, false);
  assert.deepEqual(collapsed.attention.map(r => r.label), ["A"]);
  assert.deepEqual(collapsed.others.map(r => r.label), ["B", "C", "D", "E", "F"]);
  assert.equal(collapsed.hiddenCount, 2);
  const open = splitClasses(rows, 6, true);
  assert.equal(open.others.length, 7);
  assert.equal(open.hiddenCount, 0);
  const manyAttention = classRows(classDto([["A", 80, 1], ["B", 81, 1], ["C", 82, 1], ["D", 83, 1], ["E", 84, 1], ["F", 85, 1], ["G", 96, 1], ["H", 97, 1], ["I", 98, 1]]));
  const crowded = splitClasses(manyAttention, 6, false);
  assert.equal(crowded.attention.length, 6);
  assert.equal(crowded.others.length, 2, "tetap ada pembanding minimal 2 kelas");
  assert.equal(crowded.hiddenCount, 1);
});

test("todaySegments: enam status berurutan dengan warna token kehadiran", () => {
  const segments = todaySegments({ present: 1198, late: 24, izin: 18, sakit: 12, alpha: 8, notYet: 24 });
  assert.deepEqual(segments.map(s => s.label), ["Hadir", "Terlambat", "Izin", "Sakit", "Alpa", "Belum absen"]);
  assert.deepEqual(segments.map(s => s.value), [1198, 24, 18, 12, 8, 24]);
  assert.deepEqual(segments.map(s => s.color), ["var(--att-hadir)", "var(--att-terlambat)", "var(--att-izin)", "var(--att-sakit)", "var(--att-alpha)", "var(--att-belum)"]);
});

test("todayCaption: jumlah hadir (tepat waktu + terlambat) dari siswa aktif", () => {
  assert.equal(todayCaption({ present: 1198, late: 24, eligible: 1284, notYet: 24, isSchoolDay: true }), "1.222 dari 1.284 siswa sudah hadir · 24 belum absen");
  assert.equal(todayCaption({ present: 10, late: 0, eligible: 10, notYet: 0, isSchoolDay: true }), "10 dari 10 siswa sudah hadir");
  assert.equal(todayCaption({ present: 0, late: 0, eligible: 10, notYet: 0, isSchoolDay: false }), "Hari ini bukan hari sekolah");
});

test("monthTileNote: pembanding bulan lalu + batas data; bulan tanpa hari tertutup dijelaskan", () => {
  const base = { closedThrough: "2026-09-25", presentPct: 95, prevMonth: "2026-08", prevPresentPct: 93.8 };
  assert.equal(monthTileNote(base), "Agustus 93,8% · data s.d. 25 Sep");
  assert.equal(monthTileNote({ ...base, prevPresentPct: null }), "Data s.d. 25 Sep");
  assert.equal(monthTileNote({ ...base, presentPct: null }), "Belum ada hari sekolah yang ditutup bulan ini");
});

test("penjaga bentuk data API menolak data rusak (grafik tidak boleh crash)", () => {
  assert.equal(isSchoolTrend(trendDto), true);
  assert.equal(isSchoolTrend([]), false);
  assert.equal(isSchoolTrend({ ...trendDto, from: "kemarin" }), false);
  assert.equal(isSchoolTrend({ ...trendDto, days: [{ date: "2026-09-18" }] }), false);
  assert.equal(isClassAnalytics({ period: { closedThrough: "2026-09-25" }, school: rate(counts(1, 0), 100), classes: classDto([["A", 90, 1]]) }), true);
  assert.equal(isClassAnalytics({ classes: "x" }), false);
  assert.equal(isSummaryAnalytics({ ...rate(counts(1, 0), 100), month: "2026-09", prevMonth: "2026-08", closedThrough: "2026-09-25", deltaPp: 0.6, prevPresentPct: 99.4, isPartial: true }), true);
  assert.equal(isSummaryAnalytics(null), false);
});
