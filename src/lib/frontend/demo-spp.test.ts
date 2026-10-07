import { test } from "node:test";
import assert from "node:assert/strict";
import { demoMonths, demoSppAnalytics } from "./demo-spp";
import { INITIAL_FILTER } from "./spp-analytics-rules";

test("demoMonths: N bulan berurutan, bulan berjalan di akhir (lintas tahun)", () => {
  assert.deepEqual(demoMonths(new Date("2026-02-15T00:00:00Z"), 3), ["2025-12", "2026-01", "2026-02"]);
});

test("demoSppAnalytics: total = jumlah tren; rincian satu tingkat di bawah lingkup", () => {
  const months = demoMonths(new Date("2026-10-07T00:00:00Z"), 6);
  const all = demoSppAnalytics(INITIAL_FILTER, months);
  assert.equal(all.scope.childLevel, "province");
  assert.equal(all.trend.length, 6);
  assert.equal(all.totals.overdue.count, all.trend.reduce((a, t) => a + t.overdue.count, 0));
  assert.equal(all.totals.billed, all.trend.reduce((a, t) => a + t.billed, 0));
  assert.equal(demoSppAnalytics({ ...INITIAL_FILTER, scope: "school", schoolId: "x" }, months).scope.childLevel, "class");
  assert.ok(all.students.some(s => s.outstanding > 0) && all.students.some(s => s.lateInvoices > 0));
});
