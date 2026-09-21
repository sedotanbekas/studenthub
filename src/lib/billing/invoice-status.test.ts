import { test } from "node:test";
import assert from "node:assert/strict";
import { localParts } from "@/lib/time/zone";
import { InvariantError } from "./errors";
import { deriveInvoiceStatus, invoiceDisplayStatus, isOverdue, remainingOf } from "./invoice-status";

test("deriveInvoiceStatus: 0 / 1 / amount-1 / amount", () => {
  assert.equal(deriveInvoiceStatus(150_000, 0), "UNPAID");
  assert.equal(deriveInvoiceStatus(150_000, 1), "PARTIAL");
  assert.equal(deriveInvoiceStatus(150_000, 149_999), "PARTIAL");
  assert.equal(deriveInvoiceStatus(150_000, 150_000), "PAID");
});

test("deriveInvoiceStatus melempar InvariantError: > amount, negatif, amount 0, bukan bulat", () => {
  assert.throws(() => deriveInvoiceStatus(150_000, 150_001), InvariantError);
  assert.throws(() => deriveInvoiceStatus(150_000, -1), InvariantError);
  assert.throws(() => deriveInvoiceStatus(0, 0), InvariantError);
  assert.throws(() => deriveInvoiceStatus(150_000, 0.5), InvariantError);
});

test("remainingOf: VOID = 0; selain itu amount - paid", () => {
  assert.equal(remainingOf({ amount: 100_000, paidAmount: 40_000, status: "PARTIAL" }), 60_000);
  assert.equal(remainingOf({ amount: 100_000, paidAmount: 0, status: "VOID" }), 0);
  assert.equal(remainingOf({ amount: 100_000, paidAmount: 100_000, status: "PAID" }), 0);
});

const base = { dueDate: "2026-09-10", hasPendingSubmission: false } as const;

test("presedensi tampilan: VOID > PAID > menunggu > jatuh tempo > PARTIAL > belum bayar", () => {
  const late = "2026-09-20";
  assert.equal(invoiceDisplayStatus({ ...base, status: "VOID", hasPendingSubmission: true }, late), "DIBATALKAN");
  assert.equal(invoiceDisplayStatus({ ...base, status: "PAID" }, late), "LUNAS");
  assert.equal(invoiceDisplayStatus({ ...base, status: "UNPAID", hasPendingSubmission: true }, late), "MENUNGGU_VERIFIKASI");
  assert.equal(invoiceDisplayStatus({ ...base, status: "PARTIAL", hasPendingSubmission: true }, late), "MENUNGGU_VERIFIKASI");
  assert.equal(invoiceDisplayStatus({ ...base, status: "PARTIAL" }, late), "JATUH_TEMPO");
  assert.equal(invoiceDisplayStatus({ ...base, status: "UNPAID" }, late), "JATUH_TEMPO");
  assert.equal(invoiceDisplayStatus({ ...base, status: "PARTIAL" }, "2026-09-10"), "SEBAGIAN");
  assert.equal(invoiceDisplayStatus({ ...base, status: "UNPAID" }, "2026-09-10"), "BELUM_BAYAR");
});

test("isOverdue: hari jatuh tempo sendiri belum lewat; zona waktu sekolah menentukan hari ini", () => {
  const inv = { status: "UNPAID" as const, dueDate: "2026-09-10" };
  assert.equal(isOverdue(inv, localParts(new Date("2026-09-10T16:59:00Z"), "WIB").ymd), false);
  assert.equal(isOverdue(inv, localParts(new Date("2026-09-10T17:00:00Z"), "WIB").ymd), true);
  assert.equal(isOverdue(inv, localParts(new Date("2026-09-10T15:00:00Z"), "WIT").ymd), true);
  assert.equal(isOverdue({ ...inv, status: "PAID" }, "2026-12-01"), false);
  assert.equal(isOverdue({ ...inv, status: "VOID" }, "2026-12-01"), false);
  assert.equal(isOverdue({ ...inv, status: "PARTIAL" }, "2026-09-11"), true);
});
