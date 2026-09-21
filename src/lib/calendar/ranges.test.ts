import { test } from "node:test";
import assert from "node:assert/strict";
import { inclusiveDays, rangeContains, rangesOverlap, removedRanges, unionRange } from "./ranges";

test("inclusiveDays menghitung kedua ujung", () => {
  assert.equal(inclusiveDays({ startDate: "2026-08-17", endDate: "2026-08-17" }), 1);
  assert.equal(inclusiveDays({ startDate: "2026-12-30", endDate: "2027-01-02" }), 4);
  assert.equal(inclusiveDays({ startDate: "2026-03-02", endDate: "2026-03-01" }), 0);
});

test("rangesOverlap inklusif di ujung", () => {
  const a = { startDate: "2026-07-01", endDate: "2026-07-10" };
  assert.equal(rangesOverlap(a, { startDate: "2026-07-10", endDate: "2026-07-20" }), true);
  assert.equal(rangesOverlap(a, { startDate: "2026-06-20", endDate: "2026-07-01" }), true);
  assert.equal(rangesOverlap(a, { startDate: "2026-07-11", endDate: "2026-07-20" }), false);
  assert.equal(rangesOverlap(a, { startDate: "2026-06-01", endDate: "2026-06-30" }), false);
  assert.equal(rangesOverlap(a, { startDate: "2026-07-03", endDate: "2026-07-04" }), true);
});

test("rangeContains", () => {
  const outer = { startDate: "2026-07-13", endDate: "2027-06-26" };
  assert.equal(rangeContains(outer, { startDate: "2026-07-13", endDate: "2026-12-19" }), true);
  assert.equal(rangeContains(outer, { startDate: "2026-07-12", endDate: "2026-12-19" }), false);
  assert.equal(rangeContains(outer, { startDate: "2027-01-04", endDate: "2027-06-27" }), false);
});

test("unionRange mengambil ujung terluar", () => {
  assert.deepEqual(
    unionRange({ startDate: "2026-05-10", endDate: "2026-05-12" }, { startDate: "2026-05-01", endDate: "2026-05-11" }),
    { startDate: "2026-05-01", endDate: "2026-05-12" },
  );
});

test("removedRanges: rentang yang hilang saat dipersempit", () => {
  const before = { startDate: "2026-07-13", endDate: "2026-12-19" };
  assert.deepEqual(removedRanges(before, before), []);
  assert.deepEqual(removedRanges(before, { startDate: "2026-07-20", endDate: "2026-12-19" }), [
    { startDate: "2026-07-13", endDate: "2026-07-19" },
  ]);
  assert.deepEqual(removedRanges(before, { startDate: "2026-07-13", endDate: "2026-12-10" }), [
    { startDate: "2026-12-11", endDate: "2026-12-19" },
  ]);
  assert.deepEqual(removedRanges(before, { startDate: "2026-07-01", endDate: "2026-12-31" }), []);
  assert.deepEqual(removedRanges(before, { startDate: "2026-08-01", endDate: "2026-11-30" }), [
    { startDate: "2026-07-13", endDate: "2026-07-31" },
    { startDate: "2026-12-01", endDate: "2026-12-19" },
  ]);
});

test("removedRanges: rentang baru tanpa irisan -> seluruh rentang lama hilang", () => {
  const before = { startDate: "2026-07-13", endDate: "2026-07-20" };
  assert.deepEqual(removedRanges(before, { startDate: "2026-09-01", endDate: "2026-09-05" }), [before]);
});
