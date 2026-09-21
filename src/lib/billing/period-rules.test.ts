import { test } from "node:test";
import assert from "node:assert/strict";
import {
  billableViolation,
  defaultDueDate,
  dueDateWindow,
  invoiceTitle,
  periodKey,
  periodKeyOfDate,
  shiftPeriod,
  validateDueDate,
  validatePeriod,
} from "./period-rules";

const TODAY = "2026-09-21";

test("periodKey = tahun*12 + (bulan-1); dari tanggal lokal", () => {
  assert.equal(periodKey(2026, 1), 2026 * 12);
  assert.equal(periodKey(2026, 12), 2026 * 12 + 11);
  assert.equal(periodKeyOfDate("2026-09-21"), periodKey(2026, 9));
});

test("shiftPeriod melintasi batas tahun", () => {
  assert.deepEqual(shiftPeriod(2026, 1, -1), { year: 2025, month: 12 });
  assert.deepEqual(shiftPeriod(2026, 11, 3), { year: 2027, month: 2 });
  assert.deepEqual(shiftPeriod(2026, 9, 0), { year: 2026, month: 9 });
});

test("validatePeriod: jendela -24..+12 bulan dari bulan ini (inklusif)", () => {
  assert.equal(validatePeriod(2024, 9, TODAY), null);
  assert.equal(validatePeriod(2027, 9, TODAY), null);
  assert.equal(validatePeriod(2024, 8, TODAY)?.code, "PERIOD_OUT_OF_RANGE");
  assert.equal(validatePeriod(2027, 10, TODAY)?.code, "PERIOD_OUT_OF_RANGE");
});

test("invoiceTitle memakai nama bulan Indonesia", () => {
  assert.equal(invoiceTitle(2026, 9), "SPP September 2026");
  assert.equal(invoiceTitle(2027, 1), "SPP Januari 2027");
});

test("defaultDueDate: tanggal 10 bulan periode (Februari 2028 juga 10)", () => {
  assert.equal(defaultDueDate(2026, 9), "2026-09-10");
  assert.equal(defaultDueDate(2028, 2), "2028-02-10");
});

test("dueDateWindow & validateDueDate: awal (periode-1) .. akhir (periode+3), tepi inklusif", () => {
  assert.deepEqual(dueDateWindow(2026, 1), { from: "2025-12-01", to: "2026-04-30" });
  assert.equal(validateDueDate("2025-12-01", 2026, 1), null);
  assert.equal(validateDueDate("2026-04-30", 2026, 1), null);
  assert.equal(validateDueDate("2025-11-30", 2026, 1)?.code, "DUE_DATE_OUT_OF_RANGE");
  assert.equal(validateDueDate("2026-05-01", 2026, 1)?.code, "DUE_DATE_OUT_OF_RANGE");
  assert.deepEqual(dueDateWindow(2026, 11), { from: "2026-10-01", to: "2027-02-28" });
});

test("billableViolation: ACTIVE selalu; INACTIVE/GRADUATED hanya tunggakan; DRAFT/MOVED tidak pernah", () => {
  const now = periodKey(2026, 9);
  assert.equal(billableViolation("ACTIVE", periodKey(2026, 12), now), null);
  assert.equal(billableViolation("INACTIVE", periodKey(2026, 9), now), null);
  assert.equal(billableViolation("GRADUATED", periodKey(2026, 1), now), null);
  assert.equal(billableViolation("INACTIVE", periodKey(2026, 10), now)?.code, "STUDENT_NOT_BILLABLE");
  assert.equal(billableViolation("GRADUATED", periodKey(2026, 10), now)?.code, "STUDENT_NOT_BILLABLE");
  assert.equal(billableViolation("DRAFT", periodKey(2026, 1), now)?.code, "STUDENT_NOT_BILLABLE");
  assert.equal(billableViolation("MOVED", periodKey(2026, 1), now)?.code, "STUDENT_NOT_BILLABLE");
});
