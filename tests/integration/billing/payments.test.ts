/**
 * Pembayaran tunai (sebagian -> lunas), aturan nominal/tanggal, blokir saat bukti menunggu, pembatalan
 * pembayaran (hitung ulang + kuitansi tetap bernomor), kuitansi, nomor tanpa celah (paralel & rollback).
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { POST as cashRoute } from "@/app/api/v1/school/invoices/[id]/payments/route";
import { POST as voidInvoiceRoute } from "@/app/api/v1/school/invoices/[id]/void/route";
import { GET as receiptRoute } from "@/app/api/v1/school/payments/[id]/receipt/route";
import { POST as voidPaymentRoute } from "@/app/api/v1/school/payments/[id]/void/route";
import { allocateDocumentNumbers } from "@/lib/billing/counter";
import { parseDocumentNumber } from "@/lib/billing/document-number";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { addDays } from "@/lib/time/zone";
import { withTx } from "@/lib/tx";
import { disconnect, prisma } from "../helpers/db";
import { callRoute, type Envelope } from "../helpers/request";
import { createTempStorage, type TempStorage } from "../helpers/storage";
import {
  createBillingSchool,
  createStudentWithToken,
  issueInvoice,
  schoolUrl,
  submitProof,
  todayWib,
  type BillingFixture,
  type InvoiceBody,
} from "./fixtures";

interface PaymentResult {
  readonly payment: { id: string; receiptNo: string; amount: number; method: string; voided: boolean; paidDate: string };
  readonly invoice: InvoiceBody;
}

let fx: BillingFixture;
let storage: TempStorage;
before(async () => {
  storage = await createTempStorage();
  fx = await createBillingSchool();
});
beforeEach(() => resetAllLimiters());
after(async () => {
  await storage.cleanup();
  await disconnect();
});

const cash = (invoiceId: string, json: Record<string, unknown>, token = fx.adminToken) =>
  callRoute<Envelope<PaymentResult>>(cashRoute, {
    method: "POST", url: schoolUrl(`/invoices/${invoiceId}/payments`), params: { id: invoiceId }, bearer: token, json: { paidDate: todayWib(), ...json },
  });

const voidPayment = (paymentId: string, reason: string) =>
  callRoute<Envelope<PaymentResult>>(voidPaymentRoute, { method: "POST", url: schoolUrl(`/payments/${paymentId}/void`), params: { id: paymentId }, bearer: fx.adminToken, json: { reason } });

const seq = (receiptNo: string | undefined): number => parseDocumentNumber(receiptNo ?? "")?.seq ?? -1;

describe("pembayaran tunai", () => {
  test("sebagian lalu penuh: PARTIAL lalu PAID + paidAt, kuitansi KWT, notifikasi tunai", async () => {
    const { student, user } = await createStudentWithToken(fx);
    const inv = await issueInvoice(fx, student.id, 0, 150_000);
    const first = await cash(inv.id, { amount: 100_000, note: "Cicilan pertama" });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.match(first.body?.data.payment.receiptNo ?? "", /^KWT-\d{4}-\d{6}$/);
    assert.deepEqual([first.body?.data.invoice.status, first.body?.data.invoice.displayStatus, first.body?.data.invoice.remaining], ["PARTIAL", first.body?.data.invoice.isOverdue ? "JATUH_TEMPO" : "SEBAGIAN", 50_000]);
    assert.equal(first.body?.data.invoice.paidAt, null);
    const second = await cash(inv.id, { amount: 50_000 });
    assert.equal(second.status, 201);
    assert.deepEqual([second.body?.data.invoice.status, second.body?.data.invoice.displayStatus, second.body?.data.invoice.remaining], ["PAID", "LUNAS", 0]);
    assert.ok(second.body?.data.invoice.paidAt);
    assert.equal(seq(second.body?.data.payment.receiptNo), seq(first.body?.data.payment.receiptNo) + 1);
    const notes = await prisma.notification.findMany({ where: { userId: user.id, type: "PAYMENT_APPROVED" }, orderBy: { createdAt: "asc" } });
    assert.equal(notes.length, 2);
    assert.equal(notes[0]?.title, "Pembayaran tunai diterima");
    assert.match(notes[1]?.body ?? "", /Tagihan lunas/);
    assert.equal(await prisma.auditLog.count({ where: { action: "payment.cash_record", schoolId: fx.school.id, entityId: first.body?.data.payment.id } }), 1);
  });

  test("aturan nominal & tanggal: > sisa, < min, tanggal masa depan / > 31 hari; sisa kecil boleh dilunasi", async () => {
    const { student } = await createStudentWithToken(fx);
    const inv = await issueInvoice(fx, student.id, 0, 25_000);
    assert.equal((await cash(inv.id, { amount: 25_001 })).body?.error?.code, "AMOUNT_EXCEEDS_REMAINING");
    assert.equal((await cash(inv.id, { amount: 9_999 })).body?.error?.code, "AMOUNT_TOO_SMALL");
    assert.equal((await cash(inv.id, { amount: 10_000, paidDate: addDays(todayWib(), 1) })).body?.error?.code, "PAID_DATE_OUT_OF_RANGE");
    assert.equal((await cash(inv.id, { amount: 10_000, paidDate: addDays(todayWib(), -32) })).body?.error?.code, "PAID_DATE_OUT_OF_RANGE");
    assert.equal((await cash(inv.id, { amount: 0 })).status, 400);
    assert.equal((await cash(inv.id, { amount: 20_000, paidDate: addDays(todayWib(), -31) })).status, 201);
    const small = await cash(inv.id, { amount: 5_000 });
    assert.equal(small.status, 201, "sisa 5.000 < minimal 10.000 tetap boleh dilunasi");
    assert.equal(small.body?.data.invoice.status, "PAID");
    const paid = await cash(inv.id, { amount: 1_000 });
    assert.equal(paid.status, 409);
    assert.equal(paid.body?.error?.code, "INVOICE_NOT_PAYABLE");
  });

  test("tunai diblokir saat bukti transfer menunggu (409); tagihan VOID 409; siswa 403", async () => {
    const s = await createStudentWithToken(fx);
    const inv = await issueInvoice(fx, s.student.id, 0);
    assert.equal((await submitProof(s, inv.id, { amount: 150_000 })).status, 201);
    const blocked = await cash(inv.id, { amount: 150_000 });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body?.error?.code, "SUBMISSION_PENDING");
    const inv2 = await issueInvoice(fx, s.student.id, 1);
    await callRoute(voidInvoiceRoute, { method: "POST", url: schoolUrl(`/invoices/${inv2.id}/void`), params: { id: inv2.id }, bearer: fx.adminToken, json: { reason: "Batal uji" } });
    assert.equal((await cash(inv2.id, { amount: 150_000 })).body?.error?.code, "INVOICE_NOT_PAYABLE");
    assert.equal((await cash(inv.id, { amount: 150_000 }, s.token)).status, 403);
  });
});

describe("pembatalan pembayaran & kuitansi", () => {
  test("void: tagihan dihitung ulang, kuitansi tetap bernomor & voided, void lagi 409, lalu tagihan bisa dibatalkan", async () => {
    const { student, user } = await createStudentWithToken(fx);
    const inv = await issueInvoice(fx, student.id, 0, 120_000);
    const paid = await cash(inv.id, { amount: 120_000 });
    const paymentId = paid.body?.data.payment.id ?? "";
    assert.equal(paid.body?.data.invoice.status, "PAID");
    assert.equal((await voidPayment(paymentId, "x")).status, 400);
    const voided = await voidPayment(paymentId, "Salah catat nominal");
    assert.equal(voided.status, 200, JSON.stringify(voided.body));
    assert.deepEqual([voided.body?.data.payment.voided, voided.body?.data.invoice.status, voided.body?.data.invoice.paidAmount, voided.body?.data.invoice.paidAt], [true, "UNPAID", 0, null]);
    assert.equal(voided.body?.data.payment.receiptNo, paid.body?.data.payment.receiptNo);
    assert.equal(await prisma.notification.count({ where: { userId: user.id, type: "PAYMENT_VOIDED" } }), 1);
    const again = await voidPayment(paymentId, "Salah catat lagi");
    assert.equal(again.status, 409);
    assert.equal(again.body?.error?.code, "PAYMENT_ALREADY_VOIDED");
    const receipt = await callRoute<Envelope<{ receiptNo: string; voided: boolean; voidReason: string; school: { name: string }; student: { id: string }; invoice: { invoiceNo: string }; amount: number }>>(receiptRoute, {
      method: "GET", url: schoolUrl(`/payments/${paymentId}/receipt`), params: { id: paymentId }, bearer: fx.adminToken,
    });
    assert.equal(receipt.status, 200, JSON.stringify(receipt.body));
    assert.deepEqual([receipt.body?.data.voided, receipt.body?.data.voidReason, receipt.body?.data.school.name, receipt.body?.data.student.id], [true, "Salah catat nominal", fx.school.name, student.id]);
    assert.equal(receipt.body?.data.invoice.invoiceNo, inv.invoiceNo);
    const voidInvoice = await callRoute<Envelope<InvoiceBody>>(voidInvoiceRoute, { method: "POST", url: schoolUrl(`/invoices/${inv.id}/void`), params: { id: inv.id }, bearer: fx.adminToken, json: { reason: "Dibatalkan setelah koreksi" } });
    assert.equal(voidInvoice.status, 200);
    assert.equal(voidInvoice.body?.data.status, "VOID");
  });

  test("void salah satu dari dua pembayaran: PAID -> PARTIAL dengan paidAt null", async () => {
    const { student } = await createStudentWithToken(fx);
    const inv = await issueInvoice(fx, student.id, 0, 100_000);
    const a = await cash(inv.id, { amount: 60_000 });
    await cash(inv.id, { amount: 40_000 });
    const res = await voidPayment(a.body?.data.payment.id ?? "", "Uang palsu dikembalikan");
    assert.deepEqual([res.body?.data.invoice.status, res.body?.data.invoice.paidAmount, res.body?.data.invoice.remaining, res.body?.data.invoice.paidAt], ["PARTIAL", 40_000, 60_000, null]);
  });
});

describe("nomor kuitansi tanpa celah", () => {
  test("20 pembayaran tunai paralel (10 tagihan x 2) -> kuitansi 1..20 unik, semua tagihan lunas", async () => {
    const school = await createBillingSchool();
    const invoices: InvoiceBody[] = [];
    for (let i = 0; i < 10; i += 1) {
      const { student } = await createStudentWithToken(school);
      invoices.push(await issueInvoice(school, student.id, 0, 100_000, { notify: false }));
    }
    const calls = invoices.flatMap((inv) => [0, 1].map(() => cash(inv.id, { amount: 50_000 }, school.adminToken)));
    const results = await Promise.all(calls);
    assert.deepEqual(results.map((r) => r.status), Array.from({ length: 20 }, () => 201), JSON.stringify(results.find((r) => r.status !== 201)?.body));
    const receipts = await prisma.payment.findMany({ where: { schoolId: school.school.id }, select: { receiptNo: true } });
    assert.deepEqual(receipts.map((r) => seq(r.receiptNo)).sort((x, y) => x - y), Array.from({ length: 20 }, (_, i) => i + 1));
    const statuses = await prisma.invoice.findMany({ where: { schoolId: school.school.id }, select: { status: true, paidAmount: true } });
    assert.ok(statuses.every((s) => s.status === "PAID" && s.paidAmount === 100_000));
  });

  test("rollback setelah alokasi nomor mengembalikan penghitung (tanpa celah)", async () => {
    const school = await createBillingSchool();
    const key = { schoolId: school.school.id, kind: "RECEIPT" as const, year: 2026 };
    await withTx((tx) => allocateDocumentNumbers(tx, key, 2, new Date()));
    await assert.rejects(withTx(async (tx) => {
      await allocateDocumentNumbers(tx, key, 5, new Date());
      throw new Error("gagal disengaja");
    }), /gagal disengaja/);
    const next = await withTx((tx) => allocateDocumentNumbers(tx, key, 1, new Date()));
    assert.deepEqual([next.first, next.numbers[0]], [3, "KWT-2026-000003"]);
  });
});
