import { test } from "node:test";
import assert from "node:assert/strict";
import { localPeriodFor, studentCountsFrom } from "./rules";

test("studentCountsFrom: status tanpa baris dihitung 0", () => {
  assert.deepEqual(studentCountsFrom([]), { active: 0, inactive: 0, draft: 0, graduated: 0, moved: 0 });
});

test("studentCountsFrom: memetakan setiap status ke kuncinya", () => {
  const counts = studentCountsFrom([
    { status: "ACTIVE", count: 12 },
    { status: "INACTIVE", count: 2 },
    { status: "DRAFT", count: 3 },
    { status: "GRADUATED", count: 4 },
    { status: "MOVED", count: 1 },
  ]);
  assert.deepEqual(counts, { active: 12, inactive: 2, draft: 3, graduated: 4, moved: 1 });
});

test("studentCountsFrom: status berulang dijumlahkan", () => {
  const counts = studentCountsFrom([
    { status: "ACTIVE", count: 5 },
    { status: "ACTIVE", count: 7 },
  ]);
  assert.equal(counts.active, 12);
});

test("localPeriod: bulan berjalan menurut zona waktu sekolah", () => {
  // 2026-09-30 17:30 UTC = 2026-10-01 00:30 WIB, 01:30 WITA, 02:30 WIT; masih 30 Sep di UTC.
  const instant = new Date("2026-09-30T17:30:00Z");
  assert.deepEqual(localPeriodFor(instant, "WIB"), { periodYear: 2026, periodMonth: 10 });
  assert.deepEqual(localPeriodFor(new Date("2026-09-30T16:30:00Z"), "WIB"), { periodYear: 2026, periodMonth: 9 });
  assert.deepEqual(localPeriodFor(new Date("2026-12-31T15:30:00Z"), "WIT"), { periodYear: 2027, periodMonth: 1 });
});
