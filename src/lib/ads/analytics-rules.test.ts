import { test } from "node:test";
import assert from "node:assert/strict";
import { changePct, ctr, fillDailySeries, resolvePeriod, shareBreakdown, sortAdRows } from "./analytics-rules";

const TODAY = "2026-09-21";
const periodOf = (q: Parameters<typeof resolvePeriod>[0]) => {
  const result = resolvePeriod(q, TODAY);
  if (!result.ok) throw new Error(result.violation.message);
  return result.period;
};
const codeOf = (q: Parameters<typeof resolvePeriod>[0]) => {
  const result = resolvePeriod(q, TODAY);
  return result.ok ? null : result.violation.code;
};

test("preset 7d/30d: periode ini termasuk hari ini, periode sebelumnya sama panjang tepat sebelum from", () => {
  assert.deepEqual(periodOf({ preset: "7d" }), { from: "2026-09-15", to: TODAY, prevFrom: "2026-09-08", prevTo: "2026-09-14", days: 7 });
  assert.deepEqual(periodOf({ preset: "30d" }), { from: "2026-08-23", to: TODAY, prevFrom: "2026-07-24", prevTo: "2026-08-22", days: 30 });
  assert.deepEqual(periodOf({}), periodOf({ preset: "7d" }), "default 7d");
});

test("rentang kustom: satu hari, maks 92 hari, to <= hari ini, from <= to, pasangan wajib lengkap", () => {
  assert.deepEqual(periodOf({ from: TODAY, to: TODAY }), { from: TODAY, to: TODAY, prevFrom: "2026-09-20", prevTo: "2026-09-20", days: 1 });
  assert.equal(periodOf({ from: "2026-06-22", to: TODAY }).days, 92);
  assert.equal(codeOf({ from: "2026-06-21", to: TODAY }), "ANALYTICS_RANGE_INVALID");
  assert.equal(codeOf({ from: "2026-09-10", to: "2026-09-22" }), "ANALYTICS_RANGE_INVALID");
  assert.equal(codeOf({ from: "2026-09-12", to: "2026-09-10" }), "ANALYTICS_RANGE_INVALID");
  assert.equal(codeOf({ from: "2026-09-12" }), "ANALYTICS_RANGE_INVALID");
  assert.equal(codeOf({ preset: "7d", from: "2026-09-12", to: TODAY }), "ANALYTICS_RANGE_INVALID");
});

test("CTR dua desimal; tanpa impresi -> null; boleh > 100%", () => {
  assert.equal(ctr(0, 0), null);
  assert.equal(ctr(1, 3), 33.33);
  assert.equal(ctr(2, 3), 66.67);
  assert.equal(ctr(3, 2), 150);
});

test("perubahan % satu desimal: 0/0 -> 0, 0 -> n -> null, turun negatif", () => {
  assert.equal(changePct(0, 0), 0);
  assert.equal(changePct(5, 0), null);
  assert.equal(changePct(150, 100), 50);
  assert.equal(changePct(50, 100), -50);
  assert.equal(changePct(1, 3), -66.7);
  assert.equal(changePct(null, 10), null);
  assert.equal(changePct(10, null), null);
});

test("deret harian diisi nol dan baris di luar rentang dibuang", () => {
  const rows = [
    { date: "2026-09-20", impressions: 5, clicks: 2, uniqueClicks: 2, chargedClicks: 1, spend: 500 },
    { date: "2026-09-01", impressions: 9, clicks: 9, uniqueClicks: 9, chargedClicks: 9, spend: 9 },
  ];
  const series = fillDailySeries(rows, "2026-09-19", "2026-09-21");
  assert.deepEqual(series.map((d) => [d.date, d.clicks, d.spend]), [["2026-09-19", 0, 0], ["2026-09-20", 2, 500], ["2026-09-21", 0, 0]]);
});

test("pangsa breakdown satu desimal selalu berjumlah 100 (sisa terbesar)", () => {
  const shares = shareBreakdown([{ key: "a", clicks: 1 }, { key: "b", clicks: 1 }, { key: "c", clicks: 1 }]);
  assert.deepEqual(shares.map((s) => s.sharePct), [33.4, 33.3, 33.3]);
  assert.equal(Math.round(shares.reduce((sum, s) => sum + s.sharePct, 0) * 10), 1000);
  assert.deepEqual(shareBreakdown([]), []);
  assert.deepEqual(shareBreakdown([{ key: "a", clicks: 0 }]).map((s) => s.sharePct), [0]);
});

test("urut tabel per iklan: kunci menurun, seri -> klik, impresi, judul", () => {
  const rows = [
    { adId: "1", title: "B", impressions: 10, clicks: 5, ctr: 50, spend: 100 },
    { adId: "2", title: "A", impressions: 10, clicks: 5, ctr: 50, spend: 100 },
    { adId: "3", title: "C", impressions: 0, clicks: 0, ctr: null, spend: 0 },
    { adId: "4", title: "D", impressions: 100, clicks: 1, ctr: 1, spend: 500 },
  ];
  assert.deepEqual(sortAdRows(rows, "clicks").map((r) => r.adId), ["2", "1", "4", "3"]);
  assert.deepEqual(sortAdRows(rows, "ctr").map((r) => r.adId), ["2", "1", "4", "3"]);
  assert.deepEqual(sortAdRows(rows, "spend").map((r) => r.adId), ["4", "2", "1", "3"]);
  assert.deepEqual(sortAdRows(rows, "impressions").map((r) => r.adId), ["4", "2", "1", "3"]);
});
