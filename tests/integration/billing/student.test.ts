/**
 * Tampilan SPP siswa: daftar (filter, VOID tersembunyi, ringkasan sisa), detail (+pembayaran, bukti,
 * rekening), info rekening (penanda 14 hari), kuitansi milik sendiri, siswa lulus, gerbang peran.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { POST as cashRoute } from "@/app/api/v1/school/invoices/[id]/payments/route";
import { POST as voidInvoiceRoute } from "@/app/api/v1/school/invoices/[id]/void/route";
import { GET as paymentInfoRoute } from "@/app/api/v1/student/payment-info/route";
import { GET as receiptRoute } from "@/app/api/v1/student/payments/[id]/receipt/route";
import { GET as detailRoute } from "@/app/api/v1/student/invoices/[id]/route";
import { GET as listRoute } from "@/app/api/v1/student/invoices/route";
import { resetAllLimiters } from "@/lib/http/rate-limits";
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
  type StudentWithToken,
} from "./fixtures";

interface StudentInvoice {
  readonly id: string;
  readonly status: string;
  readonly displayStatus: string;
  readonly remaining: number;
  readonly pendingSubmission: { id: string; amount: number } | null;
}

interface PaymentInfo {
  readonly bankName: string | null;
  readonly bankAccountNumber: string | null;
  readonly bankRecentlyChanged: boolean;
  readonly notice: string;
}

let fx: BillingFixture;
let storage: TempStorage;
let s: StudentWithToken;
let ids: { past: string; paid: string; voided: string; future: string; paymentId: string };

before(async () => {
  storage = await createTempStorage();
  fx = await createBillingSchool();
  s = await createStudentWithToken(fx);
  const past = await issueInvoice(fx, s.student.id, -1, 150_000);
  const paid = await issueInvoice(fx, s.student.id, 0, 100_000);
  const voided = await issueInvoice(fx, s.student.id, 1, 150_000);
  const future = await issueInvoice(fx, s.student.id, 2, 120_000);
  const pay = await callRoute<Envelope<{ payment: { id: string } }>>(cashRoute, {
    method: "POST", url: schoolUrl(`/invoices/${paid.id}/payments`), params: { id: paid.id }, bearer: fx.adminToken, json: { amount: 100_000, paidDate: todayWib() },
  });
  await callRoute(voidInvoiceRoute, { method: "POST", url: schoolUrl(`/invoices/${voided.id}/void`), params: { id: voided.id }, bearer: fx.adminToken, json: { reason: "Salah periode" } });
  assert.equal((await submitProof(s, future.id, { amount: 50_000 })).status, 201);
  ids = { past: past.id, paid: paid.id, voided: voided.id, future: future.id, paymentId: pay.body?.data.payment.id ?? "" };
});
beforeEach(() => resetAllLimiters());
after(async () => {
  await storage.cleanup();
  await disconnect();
});

const list = (student: StudentWithToken, filter?: string) =>
  callRoute<Envelope<StudentInvoice[]>>(listRoute, { method: "GET", url: `/api/v1/student/invoices${filter ? `?filter=${filter}` : ""}`, bearer: student.token });

describe("daftar & detail tagihan siswa", () => {
  test("OUTSTANDING (default) urut jatuh tempo, PAID, ALL tanpa VOID; ringkasan sisa", async () => {
    const outstanding = await list(s);
    assert.equal(outstanding.status, 200, JSON.stringify(outstanding.body));
    assert.deepEqual(outstanding.body?.data.map((i) => i.id), [ids.past, ids.future]);
    assert.deepEqual(outstanding.body?.meta?.summary, { outstandingAmount: 270_000, outstandingCount: 2 });
    const future = outstanding.body?.data.find((i) => i.id === ids.future);
    assert.deepEqual([future?.displayStatus, future?.pendingSubmission?.amount], ["MENUNGGU_VERIFIKASI", 50_000]);
    assert.equal(outstanding.body?.data.find((i) => i.id === ids.past)?.displayStatus, "JATUH_TEMPO");
    assert.deepEqual((await list(s, "PAID")).body?.data.map((i) => i.id), [ids.paid]);
    const all = (await list(s, "ALL")).body?.data.map((i) => i.id) ?? [];
    assert.deepEqual([...all].sort(), [ids.past, ids.paid, ids.future].sort());
    assert.equal((await list(s, "VOID")).status, 400);
  });

  test("detail: pembayaran, bukti, rekening sekolah; tagihan dibatalkan tetap dapat dibuka (tautan notifikasi)", async () => {
    const paid = await callRoute<Envelope<StudentInvoice & { payments: Array<{ id: string; voided: boolean }>; bankAccount: PaymentInfo }>>(detailRoute, {
      method: "GET", url: `/api/v1/student/invoices/${ids.paid}`, params: { id: ids.paid }, bearer: s.token,
    });
    assert.equal(paid.status, 200, JSON.stringify(paid.body));
    assert.deepEqual(paid.body?.data.payments.map((p) => [p.id, p.voided]), [[ids.paymentId, false]]);
    assert.deepEqual([paid.body?.data.bankAccount.bankName, paid.body?.data.bankAccount.bankRecentlyChanged], ["Bank Uji", false]);
    const voided = await callRoute<Envelope<StudentInvoice & { voidReason: string }>>(detailRoute, {
      method: "GET", url: `/api/v1/student/invoices/${ids.voided}`, params: { id: ids.voided }, bearer: s.token,
    });
    assert.deepEqual([voided.body?.data.displayStatus, voided.body?.data.voidReason], ["DIBATALKAN", "Salah periode"]);
  });

  test("siswa lain: daftar tidak memuat, detail & kuitansi 404", async () => {
    const other = await createStudentWithToken(fx);
    assert.deepEqual((await list(other, "ALL")).body?.data, []);
    assert.deepEqual((await list(other)).body?.meta?.summary, { outstandingAmount: 0, outstandingCount: 0 });
    assert.equal((await callRoute(detailRoute, { method: "GET", url: `/api/v1/student/invoices/${ids.past}`, params: { id: ids.past }, bearer: other.token })).status, 404);
    assert.equal((await callRoute(receiptRoute, { method: "GET", url: `/api/v1/student/payments/${ids.paymentId}/receipt`, params: { id: ids.paymentId }, bearer: other.token })).status, 404);
  });

  test("kuitansi milik sendiri; siswa LULUS boleh membaca; admin memanggil endpoint siswa 403", async () => {
    const receipt = await callRoute<Envelope<{ receiptNo: string; amount: number; voided: boolean; student: { id: string } }>>(receiptRoute, {
      method: "GET", url: `/api/v1/student/payments/${ids.paymentId}/receipt`, params: { id: ids.paymentId }, bearer: s.token,
    });
    assert.equal(receipt.status, 200, JSON.stringify(receipt.body));
    assert.deepEqual([receipt.body?.data.amount, receipt.body?.data.voided, receipt.body?.data.student.id], [100_000, false, s.student.id]);
    const grad = await createStudentWithToken(fx, { status: "GRADUATED" });
    assert.equal((await list(grad)).status, 200);
    assert.equal((await callRoute(paymentInfoRoute, { method: "GET", url: "/api/v1/student/payment-info", bearer: grad.token })).status, 200);
    const admin = await callRoute(listRoute, { method: "GET", url: "/api/v1/student/invoices", bearer: fx.adminToken });
    assert.equal(admin.status, 403);
  });
});

describe("info rekening SPP", () => {
  test("rekening berubah < 14 hari -> ditandai; rekening belum diatur -> null + pemberitahuan", async () => {
    const changed = await createBillingSchool({ bankChangedAt: new Date(Date.now() - 3 * 86_400_000) });
    const a = await createStudentWithToken(changed);
    const info = await callRoute<Envelope<PaymentInfo>>(paymentInfoRoute, { method: "GET", url: "/api/v1/student/payment-info", bearer: a.token });
    assert.equal(info.status, 200, JSON.stringify(info.body));
    assert.deepEqual([info.body?.data.bankAccountNumber, info.body?.data.bankRecentlyChanged], ["1234567890", true]);
    assert.match(info.body?.data.notice ?? "", /berubah/);
    const plain = await callRoute<Envelope<PaymentInfo>>(paymentInfoRoute, { method: "GET", url: "/api/v1/student/payment-info", bearer: s.token });
    assert.equal(plain.body?.data.bankRecentlyChanged, false);
    const unset = await createBillingSchool({ bankChangedAt: null });
    await prisma.school.update({ where: { id: unset.school.id }, data: { bankName: null, bankAccountNumber: null, bankAccountHolder: null } });
    const u = await createStudentWithToken(unset);
    const none = await callRoute<Envelope<PaymentInfo>>(paymentInfoRoute, { method: "GET", url: "/api/v1/student/payment-info", bearer: u.token });
    assert.deepEqual([none.body?.data.bankName, none.body?.data.bankAccountNumber, none.body?.data.bankRecentlyChanged], [null, null, false]);
    assert.match(none.body?.data.notice ?? "", /belum diatur/);
  });
});
