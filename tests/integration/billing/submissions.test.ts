/**
 * Unggah bukti transfer oleh siswa (multipart): berkas privat terikat, satu pending per tagihan, aturan
 * nominal/tanggal/status, kuota harian 429, pembatalan milik sendiri, status siswa, unggahan paralel.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { POST as voidInvoiceRoute } from "@/app/api/v1/school/invoices/[id]/void/route";
import { POST as cashRoute } from "@/app/api/v1/school/invoices/[id]/payments/route";
import { POST as cancelRoute } from "@/app/api/v1/student/payment-submissions/[id]/cancel/route";
import { POST as submitRoute } from "@/app/api/v1/student/invoices/[id]/submissions/route";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { addDays } from "@/lib/time/zone";
import { disconnect, prisma } from "../helpers/db";
import { callRoute, type Envelope } from "../helpers/request";
import { createTempStorage, type TempStorage } from "../helpers/storage";
import {
  callMultipartWithParams,
  createBillingSchool,
  createStudentWithToken,
  issueInvoice,
  proofForm,
  schoolUrl,
  submitProof,
  todayWib,
  type BillingFixture,
  type StudentWithToken,
  type SubmissionBody,
} from "./fixtures";

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

const cancel = (s: StudentWithToken, id: string) =>
  callRoute<Envelope<SubmissionBody>>(cancelRoute, { method: "POST", url: `/api/v1/student/payment-submissions/${id}/cancel`, params: { id }, bearer: s.token });

async function storedFileCount(): Promise<number> {
  const entries = await readdir(join(storage.root, "private", "payment-proof"), { recursive: true, withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isFile()).length;
}

describe("unggah bukti transfer", () => {
  test("201: StoredFile privat terikat + dHash, pendingInvoiceId, admin dinotifikasi PAYMENT_SUBMITTED", async () => {
    const s = await createStudentWithToken(fx);
    const inv = await issueInvoice(fx, s.student.id, 0);
    const res = await submitProof(s, inv.id, { amount: 150_000, senderName: "  Budi   Santoso ", note: "Transfer via m-banking" });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const sub = await prisma.paymentSubmission.findFirst({ where: { id: res.body?.data.id, schoolId: fx.school.id }, include: { proofFile: true } });
    assert.deepEqual([sub?.status, sub?.pendingInvoiceId, sub?.senderName, sub?.amount], ["PENDING", inv.id, "Budi Santoso", 150_000]);
    assert.deepEqual([sub?.proofFile.kind, sub?.proofFile.mimeType, sub?.proofFile.schoolId, sub?.proofFile.uploadedById], ["PAYMENT_PROOF", "image/jpeg", fx.school.id, s.user.id]);
    assert.ok(sub?.proofFile.attachedAt);
    assert.match(sub?.proofFile.phash ?? "", /^[0-9a-f]{16}$/);
    assert.match(sub?.proofFile.storageKey ?? "", /^private\/payment-proof\//);
    const note = await prisma.notification.findFirst({ where: { userId: fx.admin.id, type: "PAYMENT_SUBMITTED", data: { equals: { screen: "payment-review", id: res.body?.data.id } } } });
    assert.ok(note, "admin sekolah menerima PAYMENT_SUBMITTED");
    assert.equal(note?.pushStatus, "SKIPPED");
  });

  test("bukti kedua saat menunggu 409 SUBMISSION_PENDING tanpa berkas tertinggal", async () => {
    const s = await createStudentWithToken(fx);
    const inv = await issueInvoice(fx, s.student.id, 0);
    assert.equal((await submitProof(s, inv.id, { amount: 50_000 })).status, 201);
    const filesBefore = await storedFileCount();
    const second = await submitProof(s, inv.id, { amount: 50_000 });
    assert.equal(second.status, 409);
    assert.equal(second.body?.error?.code, "SUBMISSION_PENDING");
    assert.equal(await storedFileCount(), filesBefore);
  });

  test("aturan: > sisa, < min, tanggal masa depan / 91 hari 422; 90 hari lalu boleh; PAID & VOID 409", async () => {
    const s = await createStudentWithToken(fx);
    const inv = await issueInvoice(fx, s.student.id, 0, 150_000);
    const codeOf = async (fields: Parameters<typeof submitProof>[2]) => (await submitProof(s, inv.id, fields)).body?.error?.code;
    assert.equal(await codeOf({ amount: 150_001 }), "AMOUNT_EXCEEDS_REMAINING");
    assert.equal(await codeOf({ amount: 9_999 }), "AMOUNT_TOO_SMALL");
    assert.equal(await codeOf({ amount: 50_000, transferDate: addDays(todayWib(), 1) }), "TRANSFER_DATE_OUT_OF_RANGE");
    assert.equal(await codeOf({ amount: 50_000, transferDate: addDays(todayWib(), -91) }), "TRANSFER_DATE_OUT_OF_RANGE");
    assert.equal((await submitProof(s, inv.id, { amount: 50_000, transferDate: addDays(todayWib(), -90) })).status, 201);
    const paidInv = await issueInvoice(fx, s.student.id, 1, 20_000);
    await callRoute(cashRoute, { method: "POST", url: schoolUrl(`/invoices/${paidInv.id}/payments`), params: { id: paidInv.id }, bearer: fx.adminToken, json: { amount: 20_000, paidDate: todayWib() } });
    assert.equal((await submitProof(s, paidInv.id, { amount: 20_000 })).body?.error?.code, "INVOICE_NOT_PAYABLE");
    const voidInv = await issueInvoice(fx, s.student.id, 2);
    await callRoute(voidInvoiceRoute, { method: "POST", url: schoolUrl(`/invoices/${voidInv.id}/void`), params: { id: voidInv.id }, bearer: fx.adminToken, json: { reason: "Batal uji" } });
    assert.equal((await submitProof(s, voidInv.id, { amount: 20_000 })).status, 409);
  });

  test("400: nominal berformat '150.000', tanpa berkas, field asing; 415 bukan gambar", async () => {
    const s = await createStudentWithToken(fx);
    const inv = await issueInvoice(fx, s.student.id, 0);
    assert.equal((await submitProof(s, inv.id, { amount: "150.000" })).status, 400);
    const noFile = await proofForm({ amount: 50_000 });
    noFile.delete("file");
    assert.equal((await callMultipartWithParams(submitRoute, { url: "/x", form: noFile, bearer: s.token, params: { id: inv.id } })).status, 400);
    const extra = await proofForm({ amount: 50_000 });
    extra.set("studentId", "lain");
    assert.equal((await callMultipartWithParams(submitRoute, { url: "/x", form: extra, bearer: s.token, params: { id: inv.id } })).status, 400);
    const text = await submitProof(s, inv.id, { amount: 50_000, file: new Blob(["bukan gambar"], { type: "image/jpeg" }) });
    assert.equal(text.status, 415, JSON.stringify(text.body));
  });

  test("kuota: 5 unggahan per tagihan per hari, ke-6 -> 429 TOO_MANY_SUBMISSIONS + Retry-After", async () => {
    const s = await createStudentWithToken(fx);
    const inv = await issueInvoice(fx, s.student.id, 0);
    for (let i = 0; i < 5; i += 1) {
      const res = await submitProof(s, inv.id, { amount: 50_000 });
      assert.equal(res.status, 201, `unggahan ${i + 1}: ${JSON.stringify(res.body)}`);
      assert.equal((await cancel(s, res.body?.data.id ?? "")).status, 200);
    }
    const sixth = await submitProof(s, inv.id, { amount: 50_000 });
    assert.equal(sixth.status, 429);
    assert.equal(sixth.body?.error?.code, "TOO_MANY_SUBMISSIONS");
    assert.ok(Number(sixth.headers.get("retry-after")) > 0);
  });
});

describe("pembatalan & status siswa", () => {
  test("batalkan milik sendiri: CANCELLED, slot dibebaskan; lagi 409; milik siswa lain 404", async () => {
    const s = await createStudentWithToken(fx);
    const otherStudent = await createStudentWithToken(fx);
    const inv = await issueInvoice(fx, s.student.id, 0);
    const sub = await submitProof(s, inv.id, { amount: 50_000 });
    const id = sub.body?.data.id ?? "";
    assert.equal((await cancel(otherStudent, id)).status, 404);
    const res = await cancel(s, id);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body?.data.status, "CANCELLED");
    const row = await prisma.paymentSubmission.findFirst({ where: { id, schoolId: fx.school.id }, select: { pendingInvoiceId: true } });
    assert.equal(row?.pendingInvoiceId, null);
    const again = await cancel(s, id);
    assert.equal(again.status, 409);
    assert.equal(again.body?.error?.code, "SUBMISSION_NOT_PENDING");
    assert.equal((await submitProof(s, inv.id, { amount: 50_000 })).status, 201);
  });

  test("tagihan siswa lain 404; siswa LULUS boleh melunasi tunggakan; siswa NONAKTIF ditolak", async () => {
    const s = await createStudentWithToken(fx);
    const otherStudent = await createStudentWithToken(fx);
    const inv = await issueInvoice(fx, s.student.id, 0);
    assert.equal((await submitProof(otherStudent, inv.id, { amount: 50_000 })).status, 404);
    const grad = await createStudentWithToken(fx, { status: "GRADUATED" });
    const arrears = await issueInvoice(fx, grad.student.id, -1);
    assert.equal((await submitProof(grad, arrears.id, { amount: 150_000 })).status, 201);
    const inactive = await createStudentWithToken(fx, { status: "INACTIVE" });
    const inactiveInv = await issueInvoice(fx, inactive.student.id, -1);
    const denied = await submitProof(inactive, inactiveInv.id, { amount: 150_000 });
    // Sesi siswa nonaktif sudah ditolak getAuth (401 ACCOUNT_INACTIVE) sebelum POLICY (403 STUDENT_NOT_ACTIVE).
    assert.ok([401, 403].includes(denied.status), String(denied.status));
    assert.equal(await prisma.paymentSubmission.count({ where: { invoiceId: inactiveInv.id } }), 0);
  });

  test("dua unggahan paralel untuk tagihan yang sama: tepat satu 201, satu 409; satu berkas tersimpan", async () => {
    const s = await createStudentWithToken(fx);
    const inv = await issueInvoice(fx, s.student.id, 0);
    const filesBefore = await storedFileCount();
    const results = await Promise.all([submitProof(s, inv.id, { amount: 50_000 }), submitProof(s, inv.id, { amount: 60_000 })]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
    assert.equal(await prisma.paymentSubmission.count({ where: { invoiceId: inv.id } }), 1);
    assert.equal(await storedFileCount(), filesBefore + 1);
  });
});
