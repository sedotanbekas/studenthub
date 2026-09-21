import { test } from "node:test";
import assert from "node:assert/strict";
import { invoiceEditViolation, restoreViolation, voidViolation } from "./invoice-edit-rules";

const unpaid = { status: "UNPAID" as const, hasPending: false };

test("VOID: tidak ada yang dapat diubah", () => {
  assert.equal(invoiceEditViolation({ status: "VOID", hasPending: false }, { note: "x" })?.code, "INVOICE_VOID");
});

test("PAID: hanya catatan", () => {
  const paid = { status: "PAID" as const, hasPending: false };
  assert.equal(invoiceEditViolation(paid, { note: "Lunas tunai" }), null);
  assert.equal(invoiceEditViolation(paid, { note: null }), null);
  assert.equal(invoiceEditViolation(paid, { title: "SPP baru" })?.code, "INVOICE_ALREADY_PAID");
  assert.equal(invoiceEditViolation(paid, { dueDate: "2026-09-15" })?.code, "INVOICE_ALREADY_PAID");
  assert.equal(invoiceEditViolation(paid, { amount: 10_000 })?.code, "INVOICE_ALREADY_PAID");
});

test("amount: hanya UNPAID tanpa pengajuan menunggu", () => {
  assert.equal(invoiceEditViolation(unpaid, { amount: 200_000 }), null);
  assert.equal(invoiceEditViolation({ status: "PARTIAL", hasPending: false }, { amount: 200_000 })?.code, "INVOICE_HAS_PAYMENTS");
  assert.equal(invoiceEditViolation({ status: "UNPAID", hasPending: true }, { amount: 200_000 })?.code, "SUBMISSION_PENDING");
});

test("dueDate boleh untuk UNPAID dan PARTIAL; judul & catatan boleh selama belum VOID/PAID", () => {
  assert.equal(invoiceEditViolation({ status: "PARTIAL", hasPending: true }, { dueDate: "2026-09-20" }), null);
  assert.equal(invoiceEditViolation(unpaid, { dueDate: "2026-09-20", title: "SPP", note: "catatan" }), null);
});

test("voidViolation: hanya UNPAID tanpa bayar & tanpa pengajuan menunggu; void dua kali ditolak", () => {
  assert.equal(voidViolation({ status: "UNPAID", paidAmount: 0, hasPending: false }), null);
  assert.equal(voidViolation({ status: "PARTIAL", paidAmount: 10_000, hasPending: false })?.code, "INVOICE_HAS_PAYMENTS");
  assert.equal(voidViolation({ status: "PAID", paidAmount: 100_000, hasPending: false })?.code, "INVOICE_HAS_PAYMENTS");
  assert.equal(voidViolation({ status: "UNPAID", paidAmount: 0, hasPending: true })?.code, "SUBMISSION_PENDING");
  assert.equal(voidViolation({ status: "VOID", paidAmount: 0, hasPending: false })?.code, "INVOICE_VOID");
});

test("restoreViolation: hanya dari VOID dan bukan siswa PINDAH", () => {
  assert.equal(restoreViolation({ status: "VOID" }, "ACTIVE"), null);
  assert.equal(restoreViolation({ status: "VOID" }, "GRADUATED"), null);
  assert.equal(restoreViolation({ status: "UNPAID" }, "ACTIVE")?.code, "INVOICE_NOT_VOID");
  assert.equal(restoreViolation({ status: "VOID" }, "MOVED")?.code, "STUDENT_NOT_BILLABLE");
});
