import { test } from "node:test";
import assert from "node:assert/strict";
import { InvariantError } from "./errors";
import {
  applyPaymentDelta,
  cashDateViolation,
  payableViolation,
  paymentAmountViolation,
  resolveApprovedAmount,
  type InvoiceMoneyState,
} from "./payment-rules";

const NOW = new Date("2026-09-21T03:00:00Z");
const EARLIER = new Date("2026-09-01T03:00:00Z");

function state(overrides: Partial<InvoiceMoneyState> = {}): InvoiceMoneyState {
  return Object.freeze({ amount: 150_000, paidAmount: 0, status: "UNPAID", paidAt: null, ...overrides });
}

test("applyPaymentDelta: UNPAID + penuh -> PAID dengan paidAt = now", () => {
  assert.deepEqual(applyPaymentDelta(state(), 150_000, NOW), { amount: 150_000, paidAmount: 150_000, status: "PAID", paidAt: NOW });
});

test("applyPaymentDelta: sebagian -> PARTIAL; PAID - x -> PARTIAL dengan paidAt null; ke 0 -> UNPAID", () => {
  assert.equal(applyPaymentDelta(state(), 50_000, NOW).status, "PARTIAL");
  const paid = state({ paidAmount: 150_000, status: "PAID", paidAt: EARLIER });
  const reverted = applyPaymentDelta(paid, -50_000, NOW);
  assert.deepEqual(reverted, { amount: 150_000, paidAmount: 100_000, status: "PARTIAL", paidAt: null });
  assert.equal(applyPaymentDelta(state({ paidAmount: 50_000, status: "PARTIAL" }), -50_000, NOW).status, "UNPAID");
});

test("applyPaymentDelta: tidak memutasi input beku; PAID + delta, negatif, lebih, dan VOID melempar", () => {
  const frozen = state({ paidAmount: 150_000, status: "PAID", paidAt: EARLIER });
  assert.throws(() => applyPaymentDelta(frozen, 1, NOW), InvariantError);
  assert.throws(() => applyPaymentDelta(state(), -1, NOW), InvariantError);
  assert.throws(() => applyPaymentDelta(state(), 150_001, NOW), InvariantError);
  assert.throws(() => applyPaymentDelta(state({ status: "VOID" }), 1_000, NOW), InvariantError);
  assert.throws(() => applyPaymentDelta(state(), 0.5, NOW), InvariantError);
  assert.equal(frozen.paidAmount, 150_000);
});

test("applyPaymentDelta: PAID tetap PAID dengan delta 0 mempertahankan paidAt lama", () => {
  const paid = state({ paidAmount: 150_000, status: "PAID", paidAt: EARLIER });
  assert.equal(applyPaymentDelta(paid, 0, NOW).paidAt, EARLIER);
});

test("paymentAmountViolation: <= sisa dan >= min(sisa, 10.000)", () => {
  assert.equal(paymentAmountViolation(50_001, 50_000)?.code, "AMOUNT_EXCEEDS_REMAINING");
  assert.equal(paymentAmountViolation(9_999, 50_000)?.code, "AMOUNT_TOO_SMALL");
  assert.equal(paymentAmountViolation(10_000, 50_000), null);
  assert.equal(paymentAmountViolation(6_500, 6_500), null);
  assert.equal(paymentAmountViolation(6_000, 6_500)?.code, "AMOUNT_TOO_SMALL");
});

test("paymentAmountViolation tanpa cicilan: wajib sama dengan sisa", () => {
  assert.equal(paymentAmountViolation(40_000, 50_000, false)?.code, "PARTIAL_NOT_ALLOWED");
  assert.equal(paymentAmountViolation(50_000, 50_000, false), null);
});

test("payableViolation: VOID/PAID -> INVOICE_NOT_PAYABLE; pending -> SUBMISSION_PENDING", () => {
  assert.equal(payableViolation({ status: "UNPAID", hasPending: false }), null);
  assert.equal(payableViolation({ status: "PARTIAL", hasPending: false }), null);
  assert.equal(payableViolation({ status: "PAID", hasPending: false })?.code, "INVOICE_NOT_PAYABLE");
  assert.equal(payableViolation({ status: "VOID", hasPending: false })?.code, "INVOICE_NOT_PAYABLE");
  assert.equal(payableViolation({ status: "UNPAID", hasPending: true })?.code, "SUBMISSION_PENDING");
});

test("cashDateViolation: [hari ini - 31, hari ini]", () => {
  assert.equal(cashDateViolation("2026-09-21", "2026-09-21"), null);
  assert.equal(cashDateViolation("2026-08-21", "2026-09-21"), null);
  assert.equal(cashDateViolation("2026-08-20", "2026-09-21")?.code, "PAID_DATE_OUT_OF_RANGE");
  assert.equal(cashDateViolation("2026-09-22", "2026-09-21")?.code, "PAID_DATE_OUT_OF_RANGE");
});

test("resolveApprovedAmount: default = nominal diajukan", () => {
  assert.deepEqual(resolveApprovedAmount({ submitted: 100_000, remaining: 150_000 }), { ok: true, amount: 100_000 });
});

test("resolveApprovedAmount: sisa < diajukan tanpa nominal -> AMOUNT_EXCEEDS_REMAINING", () => {
  const r = resolveApprovedAmount({ submitted: 100_000, remaining: 60_000 });
  assert.equal(r.ok ? null : r.violation.code, "AMOUNT_EXCEEDS_REMAINING");
  const withAmount = resolveApprovedAmount({ submitted: 100_000, remaining: 60_000, requested: 60_000, note: "Sisa tagihan" });
  assert.deepEqual(withAmount, { ok: true, amount: 60_000 });
});

test("resolveApprovedAmount: di atas diajukan, di atas sisa, 0, dan kurang tanpa catatan ditolak", () => {
  const codeOf = (r: ReturnType<typeof resolveApprovedAmount>) => (r.ok ? null : r.violation.code);
  assert.equal(codeOf(resolveApprovedAmount({ submitted: 100_000, remaining: 150_000, requested: 100_001 })), "APPROVED_AMOUNT_INVALID");
  assert.equal(codeOf(resolveApprovedAmount({ submitted: 100_000, remaining: 50_000, requested: 60_000, note: "x" })), "AMOUNT_EXCEEDS_REMAINING");
  assert.equal(codeOf(resolveApprovedAmount({ submitted: 100_000, remaining: 150_000, requested: 0, note: "x" })), "APPROVED_AMOUNT_INVALID");
  assert.equal(codeOf(resolveApprovedAmount({ submitted: 100_000, remaining: 150_000, requested: 97_500 })), "NOTE_REQUIRED");
  assert.equal(codeOf(resolveApprovedAmount({ submitted: 100_000, remaining: 150_000, requested: 97_500, note: "  " })), "NOTE_REQUIRED");
  assert.deepEqual(resolveApprovedAmount({ submitted: 100_000, remaining: 150_000, requested: 97_500, note: "Potongan biaya admin bank" }), { ok: true, amount: 97_500 });
});
