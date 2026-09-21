import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_BULK_INVOICE_STUDENTS, MAX_INVOICE_AMOUNT } from "./constants";
import { bulkInvoicesContract } from "./contracts-invoices";
import { bulkInvoiceBody } from "./schemas";

test("batas ukuran body tagihan massal menampung payload terbesar yang lolos skema (3.000 siswa + 3.000 override, id 64 karakter)", () => {
  const id = (i: number) => `s${String(i).padStart(63, "0")}`;
  const studentIds = Array.from({ length: MAX_BULK_INVOICE_STUDENTS }, (_, i) => id(i));
  const body = {
    periodYear: 2026, periodMonth: 9, amount: MAX_INVOICE_AMOUNT, dueDate: "2026-09-10", title: "T".repeat(100),
    scope: { type: "STUDENTS", studentIds },
    overrides: studentIds.map((studentId) => ({ studentId, amount: MAX_INVOICE_AMOUNT })),
    dryRun: false, notify: true,
  };
  assert.equal(bulkInvoiceBody.safeParse(body).success, true, "payload valid menurut skema");
  const bytes = Buffer.byteLength(JSON.stringify(body));
  assert.ok(bulkInvoicesContract.maxBodyBytes !== undefined && bytes <= bulkInvoicesContract.maxBodyBytes, `${bytes} byte > ${String(bulkInvoicesContract.maxBodyBytes)}`);
});
