import { test } from "node:test";
import assert from "node:assert/strict";
import { formatLocalDate, formatRupiah, periodLabel } from "./format";

test("formatRupiah memakai titik ribuan tanpa desimal", () => {
  assert.equal(formatRupiah(0), "Rp 0");
  assert.equal(formatRupiah(950), "Rp 950");
  assert.equal(formatRupiah(1_000), "Rp 1.000");
  assert.equal(formatRupiah(1_250_000), "Rp 1.250.000");
  assert.equal(formatRupiah(50_000_000), "Rp 50.000.000");
});

test("formatLocalDate & periodLabel berbahasa Indonesia", () => {
  assert.equal(formatLocalDate("2026-09-10"), "10 September 2026");
  assert.equal(formatLocalDate("2027-01-01"), "1 Januari 2027");
  assert.equal(periodLabel(2026, 2), "Februari 2026");
  assert.equal(periodLabel(2026, 12), "Desember 2026");
});
