/**
 * Verifikasi bukti transfer oleh admin: approve penuh/sebagian, aturan nominal & catatan, reject beralasan,
 * balapan approve-approve & approve-reject, penanda bukti mirip, antrean & detail.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { POST as approveRoute } from "@/app/api/v1/school/payment-submissions/[id]/approve/route";
import { POST as rejectRoute } from "@/app/api/v1/school/payment-submissions/[id]/reject/route";
import { GET as detailRoute } from "@/app/api/v1/school/payment-submissions/[id]/route";
import { GET as listRoute } from "@/app/api/v1/school/payment-submissions/route";
import { GET as ownInvoiceRoute } from "@/app/api/v1/student/invoices/[id]/route";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { addDays } from "@/lib/time/zone";
import { disconnect, prisma } from "../helpers/db";
import { callRoute, type Envelope } from "../helpers/request";
import { createTempStorage, type TempStorage } from "../helpers/storage";
import {
  createBillingSchool,
  createStudentWithToken,
  issueInvoice,
  proofImage,
  schoolUrl,
  submitProof,
  todayWib,
  type BillingFixture,
  type InvoiceBody,
  type StudentWithToken,
} from "./fixtures";

interface AdminSubmission {
  readonly id: string;
  readonly status: string;
  readonly reviewNote: string | null;
  readonly possibleDuplicateOf: string[];
  readonly invoice: { id: string; remaining: number };
  readonly student: { id: string };
}

interface ApproveResult {
  readonly submission: AdminSubmission;
  readonly payment: { id: string; receiptNo: string; amount: number; method: string; paidDate: string; submissionId: string };
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

const approve = (id: string, json: Record<string, unknown> = {}) =>
  callRoute<Envelope<ApproveResult>>(approveRoute, { method: "POST", url: schoolUrl(`/payment-submissions/${id}/approve`), params: { id }, bearer: fx.adminToken, json });
const reject = (id: string, reason: string) =>
  callRoute<Envelope<AdminSubmission>>(rejectRoute, { method: "POST", url: schoolUrl(`/payment-submissions/${id}/reject`), params: { id }, bearer: fx.adminToken, json: { reason } });

async function pendingSubmission(amount = 150_000, invoiceAmount = 150_000, transferDate = todayWib()): Promise<{ s: StudentWithToken; inv: InvoiceBody; id: string }> {
  const s = await createStudentWithToken(fx);
  const inv = await issueInvoice(fx, s.student.id, 0, invoiceAmount);
  const res = await submitProof(s, inv.id, { amount, transferDate });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { s, inv, id: res.body?.data.id ?? "" };
}

describe("setujui bukti transfer", () => {
  test("penuh: PAID, Payment TRANSFER dengan paidDate = tanggal transfer, kuitansi, notifikasi, audit; approve lagi 409", async () => {
    const transferDate = addDays(todayWib(), -3);
    const { s, id } = await pendingSubmission(150_000, 150_000, transferDate);
    const res = await approve(id);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const data = res.body?.data as ApproveResult;
    assert.deepEqual([data.submission.status, data.invoice.status, data.invoice.displayStatus, data.invoice.pendingSubmissionId], ["APPROVED", "PAID", "LUNAS", null]);
    assert.deepEqual([data.payment.method, data.payment.paidDate, data.payment.amount, data.payment.submissionId], ["TRANSFER", transferDate, 150_000, id]);
    assert.match(data.payment.receiptNo, /^KWT-/);
    const note = await prisma.notification.findFirst({ where: { userId: s.user.id, type: "PAYMENT_APPROVED" } });
    assert.equal(note?.title, "Pembayaran diterima");
    assert.equal(await prisma.auditLog.count({ where: { action: "submission.approve", entityId: id } }), 1);
    const again = await approve(id);
    assert.equal(again.status, 409);
    assert.equal(again.body?.error?.code, "SUBMISSION_ALREADY_REVIEWED");
  });

  test("sebagian: nominal < bukti wajib catatan (422 NOTE_REQUIRED), > bukti 422; dengan catatan -> PARTIAL", async () => {
    const { id } = await pendingSubmission(100_000, 150_000);
    assert.equal((await approve(id, { approvedAmount: 97_500 })).body?.error?.code, "NOTE_REQUIRED");
    assert.equal((await approve(id, { approvedAmount: 100_001, note: "x" })).body?.error?.code, "APPROVED_AMOUNT_INVALID");
    assert.equal((await approve(id, { approvedAmount: 0 })).status, 400);
    const res = await approve(id, { approvedAmount: 97_500, note: "Potongan biaya admin bank" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual([res.body?.data.invoice.status, res.body?.data.invoice.paidAmount, res.body?.data.submission.reviewNote], ["PARTIAL", 97_500, "Potongan biaya admin bank"]);
  });

  test("sisa turun di bawah nominal bukti: approve tanpa nominal 422 AMOUNT_EXCEEDS_REMAINING; dengan nominal = sisa -> PAID", async () => {
    const { inv, id } = await pendingSubmission(100_000, 150_000);
    // Simulasi pembayaran lain yang tercatat bersamaan (jalur API memblokir tunai saat bukti menunggu).
    await prisma.invoice.update({ where: { id: inv.id }, data: { paidAmount: 100_000, status: "PARTIAL" } });
    const res = await approve(id);
    assert.equal(res.status, 422);
    assert.equal(res.body?.error?.code, "AMOUNT_EXCEEDS_REMAINING");
    const ok = await approve(id, { approvedAmount: 50_000, note: "Sisa tagihan" });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body?.data.invoice.status, "PAID");
  });
});

describe("tolak & balapan", () => {
  test("tolak: alasan wajib 5..255; REJECTED + slot dibebaskan; alasan terlihat siswa + notifikasi PAYMENT_REJECTED", async () => {
    const { s, inv, id } = await pendingSubmission();
    assert.equal((await reject(id, "abc")).status, 400);
    const res = await reject(id, "Bukti tidak terbaca");
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual([res.body?.data.status, res.body?.data.reviewNote], ["REJECTED", "Bukti tidak terbaca"]);
    const detail = await callRoute<Envelope<{ displayStatus: string; submissions: Array<{ id: string; reviewNote: string | null }> }>>(ownInvoiceRoute, {
      method: "GET", url: `/api/v1/student/invoices/${inv.id}`, params: { id: inv.id }, bearer: s.token,
    });
    assert.equal(detail.body?.data.submissions.find((x) => x.id === id)?.reviewNote, "Bukti tidak terbaca");
    assert.notEqual(detail.body?.data.displayStatus, "MENUNGGU_VERIFIKASI");
    const note = await prisma.notification.findFirst({ where: { userId: s.user.id, type: "PAYMENT_REJECTED" } });
    assert.match(note?.body ?? "", /Bukti tidak terbaca/);
    assert.equal((await submitProof(s, inv.id, { amount: 150_000 })).status, 201, "slot pending dibebaskan");
  });

  test("dua approve bersamaan: satu 200, satu 409, tepat satu Payment", async () => {
    const { inv, id } = await pendingSubmission();
    const results = await Promise.all([approve(id), approve(id)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(await prisma.payment.count({ where: { invoiceId: inv.id } }), 1);
    const invoice = await prisma.invoice.findFirst({ where: { id: inv.id, schoolId: fx.school.id }, select: { paidAmount: true, status: true } });
    assert.deepEqual(invoice, { paidAmount: 150_000, status: "PAID" });
  });

  test("approve vs reject bersamaan: tepat satu menang, status konsisten", async () => {
    const { inv, id } = await pendingSubmission();
    const [a, r] = await Promise.all([approve(id), reject(id, "Ditolak bersamaan")]);
    assert.deepEqual([a.status, r.status].sort(), [200, 409]);
    const sub = await prisma.paymentSubmission.findFirst({ where: { id, schoolId: fx.school.id }, select: { status: true, pendingInvoiceId: true } });
    const payments = await prisma.payment.count({ where: { invoiceId: inv.id } });
    assert.equal(sub?.pendingInvoiceId, null);
    assert.equal(payments, sub?.status === "APPROVED" ? 1 : 0);
  });
});

describe("antrean, detail, penanda bukti mirip", () => {
  test("foto sama (encode ulang PNG) di tagihan lain ditandai; foto berbeda tidak", async () => {
    const image = await proofImage(424_242);
    const same = await proofImage(424_242, "png");
    const a = await createStudentWithToken(fx);
    const b = await createStudentWithToken(fx);
    const invA = await issueInvoice(fx, a.student.id, 0);
    const invB = await issueInvoice(fx, b.student.id, 0);
    const invC = await issueInvoice(fx, b.student.id, 1);
    const subA = await submitProof(a, invA.id, { amount: 150_000, file: image });
    const subB = await submitProof(b, invB.id, { amount: 150_000, file: same });
    const subC = await submitProof(b, invC.id, { amount: 150_000, file: await proofImage(777_001) });
    const list = await callRoute<Envelope<AdminSubmission[]>>(listRoute, { method: "GET", url: schoolUrl("/payment-submissions?limit=100"), bearer: fx.adminToken });
    assert.equal(list.status, 200, JSON.stringify(list.body));
    const byId = new Map((list.body?.data ?? []).map((x) => [x.id, x]));
    assert.deepEqual(byId.get(subB.body?.data.id ?? "")?.possibleDuplicateOf, [subA.body?.data.id]);
    assert.deepEqual(byId.get(subA.body?.data.id ?? "")?.possibleDuplicateOf, [subB.body?.data.id]);
    assert.deepEqual(byId.get(subC.body?.data.id ?? "")?.possibleDuplicateOf, []);
    const detail = await callRoute<Envelope<AdminSubmission & { history: unknown[]; payment: unknown; reviewedBy: unknown }>>(detailRoute, {
      method: "GET", url: schoolUrl(`/payment-submissions/${subB.body?.data.id}`), params: { id: subB.body?.data.id ?? "" }, bearer: fx.adminToken,
    });
    assert.equal(detail.status, 200);
    assert.deepEqual([detail.body?.data.possibleDuplicateOf, detail.body?.data.payment, detail.body?.data.reviewedBy], [[subA.body?.data.id], null, null]);
  });

  test("antrean default PENDING terlama dulu; filter ALL/REJECTED, q NIS; detail setelah approve memuat pembayaran & peninjau + riwayat", async () => {
    const first = await pendingSubmission();
    const second = await pendingSubmission();
    const list = async (qs: string) =>
      (await callRoute<Envelope<AdminSubmission[]>>(listRoute, { method: "GET", url: schoolUrl(`/payment-submissions?limit=100${qs}`), bearer: fx.adminToken })).body?.data.map((x) => x.id) ?? [];
    const pending = await list("");
    assert.ok(pending.indexOf(first.id) < pending.indexOf(second.id), "PENDING urut terlama dulu");
    assert.deepEqual(await list(`&q=${encodeURIComponent(first.s.student.nis)}`), [first.id]);
    await reject(second.id, "Nominal tidak sesuai");
    assert.ok((await list("&status=REJECTED")).includes(second.id));
    assert.ok(!(await list("")).includes(second.id));
    await approve(first.id);
    const retry = await submitProof(second.s, second.inv.id, { amount: 150_000 });
    const detail = await callRoute<Envelope<{ payment: { receiptNo: string } | null; reviewedBy: { id: string } | null; history: Array<{ id: string }> }>>(detailRoute, {
      method: "GET", url: schoolUrl(`/payment-submissions/${first.id}`), params: { id: first.id }, bearer: fx.adminToken,
    });
    assert.match(detail.body?.data.payment?.receiptNo ?? "", /^KWT-/);
    assert.equal(detail.body?.data.reviewedBy?.id, fx.admin.id);
    const retryDetail = await callRoute<Envelope<{ history: Array<{ id: string }> }>>(detailRoute, {
      method: "GET", url: schoolUrl(`/payment-submissions/${retry.body?.data.id}`), params: { id: retry.body?.data.id ?? "" }, bearer: fx.adminToken,
    });
    assert.deepEqual(retryDetail.body?.data.history.map((h) => h.id), [second.id]);
  });
});
