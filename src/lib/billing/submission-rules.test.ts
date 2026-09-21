import { test } from "node:test";
import assert from "node:assert/strict";
import { submissionViolation, transferDateViolation, type SubmissionState } from "./submission-rules";

const TODAY = "2026-09-21";

function ctx(overrides: Partial<SubmissionState> = {}): SubmissionState {
  return { status: "UNPAID", amount: 150_000, paidAmount: 0, hasPending: false, submittedToday: 0, ...overrides };
}

const codeOf = (state: SubmissionState, amount: number, transferDate = TODAY) =>
  submissionViolation(state, { amount, transferDate }, TODAY)?.code ?? null;

test("nominal: melebihi sisa ditolak; 9.999 dari sisa 50.000 ditolak; 6.500 dari sisa 6.500 diterima", () => {
  assert.equal(codeOf(ctx(), 150_001), "AMOUNT_EXCEEDS_REMAINING");
  assert.equal(codeOf(ctx({ status: "PARTIAL", paidAmount: 100_000 }), 9_999), "AMOUNT_TOO_SMALL");
  assert.equal(codeOf(ctx({ status: "PARTIAL", paidAmount: 143_500 }), 6_500), null);
  assert.equal(codeOf(ctx(), 150_000), null);
});

test("tanggal transfer: masa depan & 91 hari lalu ditolak; 90 hari lalu diterima", () => {
  assert.equal(transferDateViolation("2026-09-22", TODAY)?.code, "TRANSFER_DATE_OUT_OF_RANGE");
  assert.equal(transferDateViolation("2026-06-23", TODAY), null);
  assert.equal(transferDateViolation("2026-06-22", TODAY)?.code, "TRANSFER_DATE_OUT_OF_RANGE");
  assert.equal(codeOf(ctx(), 50_000, "2026-09-22"), "TRANSFER_DATE_OUT_OF_RANGE");
});

test("status tagihan: pengajuan menunggu, PAID, dan VOID ditolak 409", () => {
  assert.equal(codeOf(ctx({ hasPending: true }), 50_000), "SUBMISSION_PENDING");
  assert.equal(codeOf(ctx({ status: "PAID", paidAmount: 150_000 }), 50_000), "INVOICE_NOT_PAYABLE");
  assert.equal(codeOf(ctx({ status: "VOID" }), 50_000), "INVOICE_NOT_PAYABLE");
});

test("kuota: pengajuan ke-6 dalam sehari ditolak 429", () => {
  assert.equal(codeOf(ctx({ submittedToday: 4 }), 50_000), null);
  assert.equal(codeOf(ctx({ submittedToday: 5 }), 50_000), "TOO_MANY_SUBMISSIONS");
});
