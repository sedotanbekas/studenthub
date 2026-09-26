import { test } from "node:test";
import assert from "node:assert/strict";
import type { ClassAnalyticsDto, SchoolTrendDto, SummaryAnalyticsDto } from "@/lib/attendance/monitor-schemas";
import { pct } from "@/lib/attendance/attendance-stats";
import { demoAnalyticsRows, demoClassAnalytics, demoSchoolTrend, demoSummaryAnalytics } from "./demo-analytics";
import { isClassAnalytics, isSchoolTrend, isSummaryAnalytics } from "./school-chart-rules";

const TODAY = "2026-09-26"; // Sabtu
const isWeekend = (date: string) => [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
type Rate = SchoolTrendDto["days"][number];
const total = (r: Pick<Rate, "counts">) => r.counts.hadir + r.counts.terlambat + r.counts.izin + r.counts.sakit + r.counts.alpha;

function assertConsistent(r: Pick<Rate, "counts" | "recorded" | "presentPct" | "latePct" | "alphaPct">, where: string): void {
  assert.equal(total(r), r.recorded, `${where}: jumlah counts = recorded`);
  assert.equal(r.presentPct, pct(r.counts.hadir + r.counts.terlambat, r.recorded), `${where}: presentPct konsisten dengan counts`);
  assert.equal(r.latePct, pct(r.counts.terlambat, r.recorded), `${where}: latePct konsisten`);
  assert.equal(r.alphaPct, pct(r.counts.alpha, r.recorded), `${where}: alphaPct konsisten`);
}

test("jalur bukan milik analitik -> undefined", () => {
  assert.equal(demoAnalyticsRows("/school/attendance/map"), undefined);
  assert.equal(demoAnalyticsRows("/school/students"), undefined);
  assert.equal(demoAnalyticsRows("/school/attendance/analytics/students/s1/trend"), undefined);
});

test("tren sekolah: 30 hari s.d. kemarin, akhir pekan bukan hari sekolah & counts 0", () => {
  const trend = demoSchoolTrend("2026-08-27", "2026-09-25", TODAY);
  assert.equal(trend.closedThrough, "2026-09-25");
  assert.equal(trend.days.length, 30);
  assert.equal(trend.days[0]?.date, "2026-08-27");
  assert.equal(trend.days.at(-1)?.date, "2026-09-25");
  for (const day of trend.days) {
    if (isWeekend(day.date)) {
      assert.equal(day.isSchoolDay, false, `${day.date} akhir pekan`);
      assert.equal(total(day), 0);
      assert.equal(day.presentPct, null);
      continue;
    }
    assert.equal(day.isSchoolDay, true, day.date);
    assertConsistent(day, day.date);
    assert.ok(day.recorded >= 1270 && day.recorded <= 1284, `${day.date}: ~1284 siswa (${day.recorded})`);
    assert.ok(day.presentPct! >= 92.5 && day.presentPct! <= 97.5, `${day.date}: hadir ${day.presentPct}`);
    assert.ok(day.latePct! >= 1 && day.latePct! <= 3.1, `${day.date}: terlambat ${day.latePct}`);
  }
  assert.ok(isSchoolTrend(trend));
});

test("tren sekolah naik tipis: rata-rata 10 hari sekolah terakhir > 10 hari sekolah pertama", () => {
  const school = demoSchoolTrend("2026-08-27", "2026-09-25", TODAY).days.filter(d => d.isSchoolDay).map(d => d.presentPct!);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  assert.ok(avg(school.slice(-10)) > avg(school.slice(0, 10)));
});

test("tren dipotong di closedThrough dan deterministik", () => {
  const trend = demoSchoolTrend("2026-09-20", "2026-09-30", TODAY);
  assert.equal(trend.to, "2026-09-30");
  assert.equal(trend.days.at(-1)?.date, "2026-09-25", "hari ini & sesudahnya belum ditutup");
  assert.deepEqual(demoSchoolTrend("2026-09-01", "2026-09-10", TODAY), demoSchoolTrend("2026-09-01", "2026-09-10", TODAY));
});

test("jalur tren membaca from/to dari query; default 30 hari s.d. kemarin", () => {
  const withQuery = demoAnalyticsRows("/school/attendance/analytics/trend?from=2026-09-12&to=2026-09-25&schoolId=x", TODAY) as SchoolTrendDto;
  assert.equal(withQuery.from, "2026-09-12");
  assert.equal(withQuery.days.length, 14);
  const fallback = demoAnalyticsRows("/school/attendance/analytics/trend?from=rusak", TODAY) as SchoolTrendDto;
  assert.ok(isSchoolTrend(fallback));
  assert.equal(fallback.days.length, 30);
});

test("per kelas bulan ini: 5-8 kelas, tepat satu di bawah 90%, persen konsisten", () => {
  const data = demoClassAnalytics("2026-09", TODAY);
  assert.ok(isClassAnalytics(data));
  assert.deepEqual(data.period, { month: "2026-09", from: "2026-09-01", to: "2026-09-30", closedThrough: "2026-09-25", isPartial: true, unclosedDates: [] });
  assert.ok(data.classes.length >= 5 && data.classes.length <= 8);
  assert.equal(data.classes.filter(c => c.presentPct! < 90).length, 1);
  assert.equal(new Set(data.classes.map(c => c.presentPct)).size, data.classes.length, "persen berbeda-beda");
  for (const c of data.classes) assertConsistent(c, c.className);
  assertConsistent(data.school, "sekolah");
  assert.ok(data.classes.some(c => c.className === "XI IPS 2"));
});

test("ringkasan bulan = rate sekolah per kelas, deltaPp positif kecil vs bulan lalu", () => {
  const summary = demoSummaryAnalytics("2026-09", TODAY);
  const classes = demoClassAnalytics("2026-09", TODAY);
  assert.ok(isSummaryAnalytics(summary));
  assert.equal(summary.presentPct, classes.school.presentPct);
  assert.equal(summary.recorded, classes.school.recorded);
  assert.equal(summary.prevMonth, "2026-08");
  assert.ok(summary.deltaPp! > 0 && summary.deltaPp! < 2, `deltaPp ${summary.deltaPp}`);
  assertConsistent(summary, "ringkasan");
  const viaPath = demoAnalyticsRows("/school/attendance/analytics/summary?month=2026-08", TODAY) as SummaryAnalyticsDto;
  assert.equal(viaPath.month, "2026-08");
  const current = demoAnalyticsRows("/school/attendance/analytics/classes") as ClassAnalyticsDto;
  assert.ok(isClassAnalytics(current), "tanpa query -> bulan berjalan");
  assert.equal(current.period.from, `${current.period.month}-01`);
});

test("awal bulan tanpa hari tertutup: kelas kosong, persen null", () => {
  const data = demoClassAnalytics("2026-10", "2026-10-01");
  assert.equal(data.classes.length, 0);
  assert.equal(data.school.presentPct, null);
  assert.equal(demoSummaryAnalytics("2026-10", "2026-10-01").presentPct, null);
});
