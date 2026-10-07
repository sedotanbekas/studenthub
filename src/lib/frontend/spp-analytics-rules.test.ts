import { test } from "node:test";
import assert from "node:assert/strict";
import { drillDown, INITIAL_FILTER, overdueShare, percentText, periodLabel, scopeOptions, sppQuery, trendSeries } from "./spp-analytics-rules";

const zero = { count: 0, amount: 0 };
const buckets = (o: number, l: number, d: number, n: number) => ({ onTime: { count: o, amount: 0 }, late: { count: l, amount: 0 }, overdue: { count: d, amount: 0 }, notDue: { count: n, amount: 0 }, billed: 0, paid: 0, outstanding: 0, collectionRate: null });

test("scopeOptions: super admin 4 lingkup; Admin Pemda di wilayahnya; admin sekolah tanpa pilihan", () => {
  assert.deepEqual(scopeOptions("SUPER_ADMIN", null).map(o => o.value), ["all", "province", "city", "school"]);
  assert.deepEqual(scopeOptions("REGION_ADMIN", { provinceCode: "32", cityCode: null }).map(o => o.value), ["all", "city", "school"]);
  assert.deepEqual(scopeOptions("REGION_ADMIN", { provinceCode: "32", cityCode: "32.76" }).map(o => o.value), ["all", "school"]);
  assert.deepEqual(scopeOptions("SCHOOL_ADMIN", null), []);
});

test("sppQuery: pilihan belum lengkap -> null; lengkap -> path berparameter", () => {
  assert.equal(sppQuery(INITIAL_FILTER), "/analytics/spp?scope=all&months=6");
  assert.equal(sppQuery({ ...INITIAL_FILTER, scope: "province" }), null);
  assert.equal(sppQuery({ ...INITIAL_FILTER, scope: "province", provinceCode: "32", months: 12 }), "/analytics/spp?scope=province&months=12&provinceCode=32");
  assert.equal(sppQuery({ ...INITIAL_FILTER, scope: "city", cityCode: "32.76" }), "/analytics/spp?scope=city&months=6&cityCode=32.76");
  assert.equal(sppQuery({ ...INITIAL_FILTER, scope: "school" }), null);
});

test("drillDown: provinsi -> kota -> sekolah; kelas berhenti", () => {
  assert.deepEqual(drillDown(INITIAL_FILTER, "province", "32"), { ...INITIAL_FILTER, scope: "province", provinceCode: "32" });
  assert.deepEqual(drillDown(INITIAL_FILTER, "city", "32.76"), { ...INITIAL_FILTER, scope: "city", provinceCode: "32", cityCode: "32.76" });
  assert.equal(drillDown(INITIAL_FILTER, "school", "S1")?.schoolId, "S1");
  assert.equal(drillDown(INITIAL_FILTER, "class", "C1"), null);
});

test("trendSeries & ringkasan teks", () => {
  const series = trendSeries([{ period: "2026-09", ...buckets(5, 2, 1, 0) }, { period: "2026-10", ...buckets(1, 0, 3, 6) }]);
  assert.deepEqual(series.map(s => [s.key, s.values]), [["onTime", [5, 1]], ["late", [2, 0]], ["overdue", [1, 3]], ["notDue", [0, 6]]]);
  assert.equal(periodLabel("2026-09"), "Sep 2026");
  assert.equal(percentText(null), "—");
  assert.equal(percentText(55.5), "55,5%");
  assert.equal(overdueShare(buckets(2, 1, 1, 0)), 25);
  assert.equal(overdueShare({ ...buckets(0, 0, 0, 0), onTime: zero }), null);
});
