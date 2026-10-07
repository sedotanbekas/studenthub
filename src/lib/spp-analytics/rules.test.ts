import { test } from "node:test";
import assert from "node:assert/strict";
import { childLevelOf, collectionRate, periodWindow, resolveAnalyticsScope, type Viewer } from "./rules";

const codeOf = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "unknown";
  }
};

const superAdmin: Viewer = { role: "SUPER_ADMIN", schoolId: null, region: null };
const schoolAdmin: Viewer = { role: "SCHOOL_ADMIN", schoolId: "S1", region: null };
const jabar: Viewer = { role: "REGION_ADMIN", schoolId: null, region: { provinceCode: "32", cityCode: null } };
const depok: Viewer = { role: "REGION_ADMIN", schoolId: null, region: { provinceCode: "32", cityCode: "32.76" } };

test("super admin: semua lingkup; kode wajib per lingkup; kota menentukan provinsinya", () => {
  assert.deepEqual(resolveAnalyticsScope(superAdmin, { scope: "all" }), { level: "all", provinceCode: null, cityCode: null, schoolId: null });
  assert.deepEqual(resolveAnalyticsScope(superAdmin, { scope: "province", provinceCode: "32" }), { level: "province", provinceCode: "32", cityCode: null, schoolId: null });
  assert.deepEqual(resolveAnalyticsScope(superAdmin, { scope: "city", cityCode: "32.76" }), { level: "city", provinceCode: "32", cityCode: "32.76", schoolId: null });
  assert.deepEqual(resolveAnalyticsScope(superAdmin, { scope: "school", schoolId: "S9" }), { level: "school", provinceCode: null, cityCode: null, schoolId: "S9" });
  assert.equal(codeOf(() => resolveAnalyticsScope(superAdmin, { scope: "province" })), "PROVINCE_REQUIRED");
  assert.equal(codeOf(() => resolveAnalyticsScope(superAdmin, { scope: "city" })), "CITY_REQUIRED");
  assert.equal(codeOf(() => resolveAnalyticsScope(superAdmin, { scope: "school" })), "SCHOOL_ID_REQUIRED");
});

test("admin sekolah: selalu sekolahnya sendiri; sekolah lain 403", () => {
  assert.deepEqual(resolveAnalyticsScope(schoolAdmin, { scope: "all" }), { level: "school", provinceCode: null, cityCode: null, schoolId: "S1" });
  assert.equal(resolveAnalyticsScope(schoolAdmin, { scope: "school", schoolId: "S1" }).schoolId, "S1");
  assert.equal(codeOf(() => resolveAnalyticsScope(schoolAdmin, { scope: "school", schoolId: "S2" })), "SCOPE_MISMATCH");
});

test("Admin Pemda: keseluruhan = wilayahnya; di luar wilayah 404", () => {
  assert.deepEqual(resolveAnalyticsScope(jabar, { scope: "all" }), { level: "province", provinceCode: "32", cityCode: null, schoolId: null });
  assert.deepEqual(resolveAnalyticsScope(depok, { scope: "all" }), { level: "city", provinceCode: "32", cityCode: "32.76", schoolId: null });
  assert.equal(resolveAnalyticsScope(jabar, { scope: "city", cityCode: "32.73" }).cityCode, "32.73");
  assert.equal(codeOf(() => resolveAnalyticsScope(jabar, { scope: "province", provinceCode: "31" })), "REGION_NOT_FOUND");
  assert.equal(codeOf(() => resolveAnalyticsScope(jabar, { scope: "city", cityCode: "31.71" })), "REGION_NOT_FOUND");
  assert.equal(codeOf(() => resolveAnalyticsScope(depok, { scope: "city", cityCode: "32.73" })), "REGION_NOT_FOUND");
  assert.equal(codeOf(() => resolveAnalyticsScope(depok, { scope: "province", provinceCode: "32" })), "REGION_NOT_FOUND", "admin kota tidak melihat seluruh provinsi");
  assert.equal(resolveAnalyticsScope(depok, { scope: "school", schoolId: "S5" }).schoolId, "S5", "sekolah diverifikasi service (DB)");
});

test("peran lain ditolak", () => {
  assert.equal(codeOf(() => resolveAnalyticsScope({ role: "SPONSOR", schoolId: null, region: null }, { scope: "all" })), "FORBIDDEN");
});

test("childLevelOf: rincian satu tingkat di bawah lingkup", () => {
  assert.equal(childLevelOf("all"), "province");
  assert.equal(childLevelOf("province"), "city");
  assert.equal(childLevelOf("city"), "school");
  assert.equal(childLevelOf("school"), "class");
});

test("periodWindow: N bulan berakhir bulan berjalan (WIB), lintas tahun", () => {
  const w = periodWindow(new Date("2026-02-10T03:00:00Z"), 6);
  assert.deepEqual(w.periods, ["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"]);
  assert.equal(w.toKey - w.fromKey, 5);
  assert.equal(w.toKey, 2026 * 12 + 1);
  // 31 Jan 18:00 UTC = 1 Feb WIB.
  assert.equal(periodWindow(new Date("2026-01-31T18:00:00Z"), 3).periods.at(-1), "2026-02");
});

test("collectionRate: terbayar dibagi tertagih, 1 desimal; tanpa tagihan = null", () => {
  assert.equal(collectionRate(750_000, 1_000_000), 75);
  assert.equal(collectionRate(1, 3), 33.3);
  assert.equal(collectionRate(0, 0), null);
});
