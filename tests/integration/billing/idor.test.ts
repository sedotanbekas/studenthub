/**
 * IDOR dua sekolah untuk SPP: id sekolah lain -> 404 di semua endpoint by-id (data tidak berubah), admin
 * dengan ?schoolId lain -> 403 SCOPE_MISMATCH, super admin tanpa schoolId -> 400, dengan schoolId -> 200,
 * siswa hanya atas miliknya sendiri.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { POST as cashRoute } from "@/app/api/v1/school/invoices/[id]/payments/route";
import { POST as restoreRoute } from "@/app/api/v1/school/invoices/[id]/restore/route";
import { GET as invoiceDetail, PATCH as invoicePatch } from "@/app/api/v1/school/invoices/[id]/route";
import { POST as voidInvoiceRoute } from "@/app/api/v1/school/invoices/[id]/void/route";
import { GET as listInvoices } from "@/app/api/v1/school/invoices/route";
import { POST as approveRoute } from "@/app/api/v1/school/payment-submissions/[id]/approve/route";
import { POST as rejectRoute } from "@/app/api/v1/school/payment-submissions/[id]/reject/route";
import { GET as submissionDetail } from "@/app/api/v1/school/payment-submissions/[id]/route";
import { GET as listSubmissions } from "@/app/api/v1/school/payment-submissions/route";
import { GET as receiptRoute } from "@/app/api/v1/school/payments/[id]/receipt/route";
import { POST as voidPaymentRoute } from "@/app/api/v1/school/payments/[id]/void/route";
import { POST as cancelOwn } from "@/app/api/v1/student/payment-submissions/[id]/cancel/route";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { disconnect, prisma } from "../helpers/db";
import { callRoute, type AnyRouteHandler, type Envelope, type HttpMethod } from "../helpers/request";
import { createTempStorage, type TempStorage } from "../helpers/storage";
import {
  createBillingSchool,
  createStudentWithToken,
  issueInvoice,
  schoolUrl,
  submitProof,
  superAdminToken,
  todayWib,
  type BillingFixture,
  type StudentWithToken,
} from "./fixtures";

let a: BillingFixture;
let b: BillingFixture;
let storage: TempStorage;
let superToken = "";
let aStudent: StudentWithToken;
let bStudent: StudentWithToken;
let bInvoiceId = "";
let bPaidInvoiceId = "";
let bSubmissionId = "";
let bPaymentId = "";

before(async () => {
  storage = await createTempStorage();
  [a, b] = [await createBillingSchool(), await createBillingSchool()];
  superToken = await superAdminToken();
  aStudent = await createStudentWithToken(a);
  bStudent = await createStudentWithToken(b);
  bInvoiceId = (await issueInvoice(b, bStudent.student.id, 0)).id;
  bSubmissionId = (await submitProof(bStudent, bInvoiceId, { amount: 50_000 })).body?.data.id ?? "";
  bPaidInvoiceId = (await issueInvoice(b, bStudent.student.id, 1, 80_000)).id;
  const pay = await callRoute<Envelope<{ payment: { id: string } }>>(cashRoute, {
    method: "POST", url: schoolUrl(`/invoices/${bPaidInvoiceId}/payments`), params: { id: bPaidInvoiceId }, bearer: b.adminToken, json: { amount: 80_000, expectedPaidAmount: 0, paidDate: todayWib() },
  });
  bPaymentId = pay.body?.data.payment.id ?? "";
  assert.ok(bSubmissionId && bPaymentId, "fixture sekolah B lengkap");
});
beforeEach(() => resetAllLimiters());
after(async () => {
  await storage.cleanup();
  await disconnect();
});

interface ByIdCall {
  readonly name: string;
  readonly handler: AnyRouteHandler;
  readonly method: HttpMethod;
  readonly path: (ids: { invoice: string; submission: string; payment: string }) => string;
  readonly json?: unknown;
}

const BY_ID: readonly ByIdCall[] = [
  { name: "detail tagihan", handler: invoiceDetail, method: "GET", path: (i) => `/invoices/${i.invoice}` },
  { name: "ubah tagihan", handler: invoicePatch, method: "PATCH", path: (i) => `/invoices/${i.invoice}`, json: { note: "IDOR" } },
  { name: "batalkan tagihan", handler: voidInvoiceRoute, method: "POST", path: (i) => `/invoices/${i.invoice}/void`, json: { reason: "Uji IDOR" } },
  { name: "pulihkan tagihan", handler: restoreRoute, method: "POST", path: (i) => `/invoices/${i.invoice}/restore` },
  { name: "tunai", handler: cashRoute, method: "POST", path: (i) => `/invoices/${i.invoice}/payments`, json: { amount: 10_000, expectedPaidAmount: 0, paidDate: todayWib() } },
  { name: "detail bukti", handler: submissionDetail, method: "GET", path: (i) => `/payment-submissions/${i.submission}` },
  { name: "setujui bukti", handler: approveRoute, method: "POST", path: (i) => `/payment-submissions/${i.submission}/approve`, json: {} },
  { name: "tolak bukti", handler: rejectRoute, method: "POST", path: (i) => `/payment-submissions/${i.submission}/reject`, json: { reason: "Uji IDOR" } },
  { name: "kuitansi", handler: receiptRoute, method: "GET", path: (i) => `/payments/${i.payment}/receipt` },
  { name: "batalkan pembayaran", handler: voidPaymentRoute, method: "POST", path: (i) => `/payments/${i.payment}/void`, json: { reason: "Uji IDOR" } },
];

function callById(c: ByIdCall, token: string, schoolId?: string, overrides: Partial<{ invoice: string }> = {}) {
  const ids = { invoice: bInvoiceId, submission: bSubmissionId, payment: bPaymentId, ...overrides };
  const path = c.path(ids);
  const id = path.split("/")[2] ?? "";
  return callRoute<Envelope>(c.handler, { method: c.method, url: schoolUrl(path, schoolId), params: { id }, json: c.json, bearer: token });
}

describe("IDOR dua sekolah (SPP)", () => {
  test("admin A atas data sekolah B -> 404 di semua endpoint by-id; data B tidak berubah", async () => {
    for (const c of BY_ID) {
      const res = await callById(c, a.adminToken);
      assert.equal(res.status, 404, `${c.name}: ${JSON.stringify(res.body)}`);
    }
    const invoice = await prisma.invoice.findFirst({ where: { id: bInvoiceId, schoolId: b.school.id }, select: { status: true, note: true, paidAmount: true } });
    assert.deepEqual(invoice, { status: "UNPAID", note: null, paidAmount: 0 });
    const sub = await prisma.paymentSubmission.findFirst({ where: { id: bSubmissionId, schoolId: b.school.id }, select: { status: true } });
    assert.equal(sub?.status, "PENDING");
    const payment = await prisma.payment.findFirst({ where: { id: bPaymentId, schoolId: b.school.id }, select: { voidedAt: true } });
    assert.equal(payment?.voidedAt, null);
  });

  test("admin A dengan ?schoolId=B -> 403 SCOPE_MISMATCH (daftar & by-id)", async () => {
    for (const handler of [listInvoices, listSubmissions]) {
      const res = await callRoute(handler, { method: "GET", url: schoolUrl(handler === listInvoices ? "/invoices" : "/payment-submissions", b.school.id), bearer: a.adminToken });
      assert.equal(res.status, 403);
      assert.equal((res.body as Envelope | null)?.error?.code, "SCOPE_MISMATCH");
    }
    assert.equal((await callById(BY_ID[0] as ByIdCall, a.adminToken, b.school.id)).status, 403);
  });

  test("daftar admin A tidak memuat tagihan & bukti sekolah B", async () => {
    const invoices = await callRoute<Envelope<Array<{ id: string }>>>(listInvoices, { method: "GET", url: schoolUrl("/invoices?limit=100"), bearer: a.adminToken });
    assert.equal(invoices.body?.data.some((i) => i.id === bInvoiceId), false);
    const subs = await callRoute<Envelope<Array<{ id: string }>>>(listSubmissions, { method: "GET", url: schoolUrl("/payment-submissions?status=ALL&limit=100"), bearer: a.adminToken });
    assert.equal(subs.body?.data.some((s) => s.id === bSubmissionId), false);
  });

  test("super admin: tanpa schoolId 400; sekolah salah 404; sekolah tak dikenal 404; dengan schoolId B 200", async () => {
    const noScope = await callRoute(listInvoices, { method: "GET", url: schoolUrl("/invoices"), bearer: superToken });
    assert.equal(noScope.status, 400);
    assert.equal((noScope.body as Envelope | null)?.error?.code, "SCHOOL_ID_REQUIRED");
    assert.equal((await callById(BY_ID[0] as ByIdCall, superToken, a.school.id)).status, 404);
    assert.equal((await callRoute(listInvoices, { method: "GET", url: schoolUrl("/invoices", "sekolah-tidak-ada"), bearer: superToken })).status, 404);
    const ok = await callById(BY_ID[0] as ByIdCall, superToken, b.school.id);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const receipt = await callById(BY_ID[8] as ByIdCall, superToken, b.school.id);
    assert.equal(receipt.status, 200);
  });

  test("siswa A tidak dapat mengunggah ke / membatalkan bukti siswa B (404)", async () => {
    assert.equal((await submitProof(aStudent, bInvoiceId, { amount: 50_000 })).status, 404);
    const cancel = await callRoute(cancelOwn, { method: "POST", url: `/api/v1/student/payment-submissions/${bSubmissionId}/cancel`, params: { id: bSubmissionId }, bearer: aStudent.token });
    assert.equal(cancel.status, 404);
  });
});
