/**
 * Tagihan tunggal: buat (aturan periode/jatuh tempo/siswa/slot), daftar + filter turunan, detail, ubah,
 * batalkan, pulihkan, gerbang peran.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { GET as listRoute, POST as createRoute } from "@/app/api/v1/school/invoices/route";
import { GET as detailRoute, PATCH as patchRoute } from "@/app/api/v1/school/invoices/[id]/route";
import { POST as restoreRoute } from "@/app/api/v1/school/invoices/[id]/restore/route";
import { POST as voidRoute } from "@/app/api/v1/school/invoices/[id]/void/route";
import { invoiceTitle } from "@/lib/billing/period-rules";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { disconnect, prisma } from "../helpers/db";
import { callRoute, type AnyRouteHandler, type Envelope, type HttpMethod } from "../helpers/request";
import { createTempStorage, type TempStorage } from "../helpers/storage";
import {
  createBillingSchool,
  createStudentWithToken,
  issueInvoice,
  periodAt,
  schoolUrl,
  submitProof,
  todayWib,
  type BillingFixture,
  type InvoiceBody,
} from "./fixtures";

let fx: BillingFixture;
let other: BillingFixture;
let storage: TempStorage;

before(async () => {
  storage = await createTempStorage();
  [fx, other] = [await createBillingSchool(), await createBillingSchool()];
});
beforeEach(() => resetAllLimiters());
after(async () => {
  await storage.cleanup();
  await disconnect();
});

type InvoiceEnvelope = Envelope<InvoiceBody>;

const create = (json: unknown, token = fx.adminToken) =>
  callRoute<InvoiceEnvelope>(createRoute, { method: "POST", url: schoolUrl("/invoices"), bearer: token, json });

const byId = (handler: AnyRouteHandler, method: HttpMethod, id: string, suffix = "", json?: unknown) =>
  callRoute<InvoiceEnvelope>(handler, { method, url: schoolUrl(`/invoices/${id}${suffix}`), params: { id }, bearer: fx.adminToken, json });

const codeOf = (body: Envelope | null | undefined): string | undefined => body?.error?.code;
const pad = (n: number): string => String(n).padStart(2, "0");

describe("buat tagihan tunggal", () => {
  test("201: nomor INV, judul & jatuh tempo default, notifikasi INVOICE_ISSUED, audit", async () => {
    const { student, user } = await createStudentWithToken(fx);
    const period = periodAt(1);
    const res = await create({ studentId: student.id, ...period, amount: 175_000, note: "  Catatan   uji  " });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const inv = res.body?.data as InvoiceBody;
    assert.match(inv.invoiceNo, /^INV-\d{4}-\d{6}$/);
    assert.equal(inv.title, invoiceTitle(period.periodYear, period.periodMonth));
    assert.equal(inv.dueDate, `${period.periodYear}-${pad(period.periodMonth)}-10`);
    assert.deepEqual([inv.status, inv.displayStatus, inv.remaining, inv.isOverdue], ["UNPAID", "BELUM_BAYAR", 175_000, false]);
    const notes = await prisma.notification.findMany({ where: { userId: user.id, type: "INVOICE_ISSUED" } });
    assert.equal(notes.length, 1);
    assert.deepEqual(notes[0]?.data, { screen: "invoice", id: inv.id });
    assert.equal(notes[0]?.pushStatus, "PENDING");
    const stored = await prisma.invoice.findFirst({ where: { id: inv.id, schoolId: fx.school.id }, select: { note: true } });
    assert.equal(stored?.note, "Catatan uji");
    assert.equal(await prisma.auditLog.count({ where: { action: "invoice.create", entityId: inv.id } }), 1);
  });

  test("notify=false tidak membuat notifikasi; judul & jatuh tempo kustom dipakai", async () => {
    const { student, user } = await createStudentWithToken(fx);
    const period = periodAt(2);
    const due = `${period.periodYear}-${pad(period.periodMonth)}-25`;
    const res = await create({ studentId: student.id, ...period, amount: 90_000, notify: false, title: "SPP Khusus", dueDate: due });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body?.data.title, "SPP Khusus");
    assert.equal(res.body?.data.dueDate, due);
    assert.equal(await prisma.notification.count({ where: { userId: user.id } }), 0);
  });

  test("400: nominal di luar batas / bukan bulat / string, bulan 13, field asing", async () => {
    const { student } = await createStudentWithToken(fx);
    const base = { studentId: student.id, ...periodAt(0), amount: 150_000 };
    for (const json of [
      { ...base, amount: 999 }, { ...base, amount: 50_000_001 }, { ...base, amount: 1500.5 }, { ...base, amount: "150000" },
      { ...base, periodMonth: 13 }, { ...base, extra: true }, { ...base, dueDate: "2026-02-30" },
    ]) {
      const res = await create(json);
      assert.equal(res.status, 400, JSON.stringify(json));
      assert.equal(codeOf(res.body), "VALIDATION_FAILED");
    }
  });

  test("422: periode di luar -24..+12 bulan dan jatuh tempo di luar jendela", async () => {
    const { student } = await createStudentWithToken(fx);
    assert.equal(codeOf((await create({ studentId: student.id, ...periodAt(13), amount: 150_000 })).body), "PERIOD_OUT_OF_RANGE");
    assert.equal(codeOf((await create({ studentId: student.id, ...periodAt(-25), amount: 150_000 })).body), "PERIOD_OUT_OF_RANGE");
    const period = periodAt(3);
    const tooLate = `${period.periodYear + 1}-${pad(period.periodMonth)}-01`;
    const res = await create({ studentId: student.id, ...period, amount: 150_000, dueDate: tooLate });
    assert.equal(res.status, 422);
    assert.equal(codeOf(res.body), "DUE_DATE_OUT_OF_RANGE");
  });

  test("422 STUDENT_NOT_BILLABLE: DRAFT & MOVED; INACTIVE/GRADUATED hanya tunggakan", async () => {
    for (const status of ["DRAFT", "MOVED"] as const) {
      const { student } = await createStudentWithToken(fx, { status });
      const res = await create({ studentId: student.id, ...periodAt(-1), amount: 150_000 });
      assert.equal(res.status, 422, status);
      assert.equal(codeOf(res.body), "STUDENT_NOT_BILLABLE");
    }
    for (const status of ["INACTIVE", "GRADUATED"] as const) {
      const { student } = await createStudentWithToken(fx, { status });
      assert.equal((await create({ studentId: student.id, ...periodAt(1), amount: 150_000 })).status, 422, `${status} masa depan`);
      assert.equal((await create({ studentId: student.id, ...periodAt(-1), amount: 150_000 })).status, 201, `${status} tunggakan`);
    }
  });

  test("409 INVOICE_EXISTS; slot yang dibatalkan memberi hint RESTORE", async () => {
    const { student } = await createStudentWithToken(fx);
    const first = await issueInvoice(fx, student.id, 1);
    const dup = await create({ studentId: student.id, ...periodAt(1), amount: 150_000 });
    assert.equal(dup.status, 409);
    assert.equal(codeOf(dup.body), "INVOICE_EXISTS");
    assert.equal((await byId(voidRoute, "POST", first.id, "/void", { reason: "Salah nominal" })).status, 200);
    const again = await create({ studentId: student.id, ...periodAt(1), amount: 150_000 });
    assert.equal(again.status, 409);
    assert.deepEqual((again.body?.error?.details as { hint: string; invoiceId: string }).hint, "RESTORE");
  });

  test("404 siswa sekolah lain / tidak ada; 403 siswa memanggil endpoint admin", async () => {
    const foreign = await createStudentWithToken(other);
    assert.equal((await create({ studentId: foreign.student.id, ...periodAt(0), amount: 150_000 })).status, 404);
    assert.equal((await create({ studentId: "tidak-ada", ...periodAt(0), amount: 150_000 })).status, 404);
    const me = await createStudentWithToken(fx);
    const res = await create({ studentId: me.student.id, ...periodAt(0), amount: 150_000 }, me.token);
    assert.equal(res.status, 403);
    assert.equal(codeOf(res.body), "FORBIDDEN");
  });
});

describe("daftar & detail", () => {
  test("filter status turunan OVERDUE & PENDING_VERIFICATION, periode, q (wildcard diloloskan)", async () => {
    const s = await createStudentWithToken(fx);
    const overdue = await issueInvoice(fx, s.student.id, -1);
    const future = await issueInvoice(fx, s.student.id, 1);
    const pending = await issueInvoice(fx, s.student.id, 2);
    assert.equal((await submitProof(s, pending.id, { amount: 50_000 })).status, 201);
    const list = async (qs: string) => {
      const res = await callRoute<Envelope<InvoiceBody[]>>(listRoute, { method: "GET", url: schoolUrl(`/invoices?studentId=${s.student.id}${qs}`), bearer: fx.adminToken });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      return (res.body?.data ?? []).map((i) => i.id).sort();
    };
    assert.deepEqual(await list(""), [overdue.id, future.id, pending.id].sort());
    assert.deepEqual(await list("&status=OVERDUE"), [overdue.id]);
    assert.deepEqual(await list("&status=pending_verification"), [pending.id]);
    assert.deepEqual(await list("&status=OVERDUE,PENDING_VERIFICATION"), [overdue.id, pending.id].sort());
    const p = periodAt(1);
    assert.deepEqual(await list(`&periodYear=${p.periodYear}&periodMonth=${p.periodMonth}`), [future.id]);
    assert.deepEqual(await list(`&q=${encodeURIComponent("%")}`), []);
    assert.deepEqual(await list(`&q=${encodeURIComponent(s.student.nis)}`), [overdue.id, future.id, pending.id].sort());
    const bad = await callRoute(listRoute, { method: "GET", url: schoolUrl("/invoices?status=LUNAS"), bearer: fx.adminToken });
    assert.equal(bad.status, 400);
    const detail = await byId(detailRoute, "GET", overdue.id);
    assert.equal(detail.body?.data.displayStatus, "JATUH_TEMPO");
    assert.equal(detail.body?.data.isOverdue, true);
  });

  test("detail memuat bukti menunggu & status tampilan MENUNGGU_VERIFIKASI", async () => {
    const s = await createStudentWithToken(fx);
    const inv = await issueInvoice(fx, s.student.id, 1);
    const sub = await submitProof(s, inv.id, { amount: 150_000 });
    const res = await callRoute<Envelope<InvoiceBody & { submissions: Array<{ id: string }>; payments: unknown[] }>>(detailRoute, {
      method: "GET", url: schoolUrl(`/invoices/${inv.id}`), params: { id: inv.id }, bearer: fx.adminToken,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body?.data.displayStatus, "MENUNGGU_VERIFIKASI");
    assert.equal(res.body?.data.pendingSubmissionId, sub.body?.data.id);
    assert.deepEqual(res.body?.data.submissions.map((x) => x.id), [sub.body?.data.id]);
    assert.deepEqual(res.body?.data.payments, []);
  });

  test("detail memuat pembayaran TERBARU dulu (maks 50): pembayaran terakhir tetap terlihat & dapat dibatalkan", async () => {
    const s = await createStudentWithToken(fx);
    const inv = await issueInvoice(fx, s.student.id, 2, 1_000_000, { notify: false });
    const base = Date.now() - 60 * 60_000;
    await prisma.payment.createMany({
      data: Array.from({ length: 55 }, (_, i) => ({
        schoolId: fx.school.id, invoiceId: inv.id, receiptNo: `KWT-UJI-${inv.invoiceNo.slice(-6)}${String(i).padStart(2, "0")}`.slice(0, 20),
        amount: 1_000, method: "CASH" as const, paidDate: new Date(), recordedById: fx.admin.id, createdAt: new Date(base + i * 1_000),
      })),
    });
    const newest = await prisma.payment.findFirstOrThrow({ where: { invoiceId: inv.id }, orderBy: { createdAt: "desc" }, select: { id: true } });
    const res = await callRoute<Envelope<{ payments: Array<{ id: string }> }>>(detailRoute, {
      method: "GET", url: schoolUrl(`/invoices/${inv.id}`), params: { id: inv.id }, bearer: fx.adminToken,
    });
    assert.equal(res.status, 200, JSON.stringify(res.body?.error));
    assert.equal(res.body?.data.payments.length, 50);
    assert.equal(res.body?.data.payments[0]?.id, newest.id);
  });
});

describe("ubah, batalkan, pulihkan", () => {
  test("PATCH UNPAID: nominal, jatuh tempo, judul, catatan (null menghapus) + audit", async () => {
    const { student } = await createStudentWithToken(fx);
    const inv = await issueInvoice(fx, student.id, 1, 150_000, { note: "awal" });
    const p = periodAt(1);
    const res = await byId(patchRoute, "PATCH", inv.id, "", { amount: 160_000, dueDate: `${p.periodYear}-${pad(p.periodMonth)}-15`, title: "SPP Revisi", note: null });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual([res.body?.data.amount, res.body?.data.title, res.body?.data.dueDate.slice(-2)], [160_000, "SPP Revisi", "15"]);
    assert.equal((res.body?.data as unknown as { note: string | null }).note, null);
    assert.equal(await prisma.auditLog.count({ where: { action: "invoice.update", entityId: inv.id } }), 1);
  });

  test("PATCH ditolak: body kosong 400, jatuh tempo di luar jendela 422, nominal saat bukti menunggu 409", async () => {
    const s = await createStudentWithToken(fx);
    const inv = await issueInvoice(fx, s.student.id, 1);
    assert.equal((await byId(patchRoute, "PATCH", inv.id, "", {})).status, 400);
    const far = await byId(patchRoute, "PATCH", inv.id, "", { dueDate: `${periodAt(6).periodYear}-${pad(periodAt(6).periodMonth)}-01` });
    assert.equal(codeOf(far.body), "DUE_DATE_OUT_OF_RANGE");
    assert.equal((await submitProof(s, inv.id, { amount: 150_000 })).status, 201);
    const blocked = await byId(patchRoute, "PATCH", inv.id, "", { amount: 100_000 });
    assert.equal(blocked.status, 409);
    assert.equal(codeOf(blocked.body), "SUBMISSION_PENDING");
    assert.equal((await byId(patchRoute, "PATCH", inv.id, "", { title: "Boleh" })).status, 200);
  });

  test("void: alasan wajib; UNPAID -> VOID + INVOICE_VOIDED; void lagi & PATCH 409 INVOICE_VOID; restore -> UNPAID", async () => {
    const { student, user } = await createStudentWithToken(fx);
    const inv = await issueInvoice(fx, student.id, 1);
    assert.equal((await byId(voidRoute, "POST", inv.id, "/void", { reason: "x" })).status, 400);
    const voided = await byId(voidRoute, "POST", inv.id, "/void", { reason: "Salah input nominal" });
    assert.equal(voided.status, 200, JSON.stringify(voided.body));
    assert.deepEqual([voided.body?.data.status, voided.body?.data.displayStatus, voided.body?.data.remaining], ["VOID", "DIBATALKAN", 0]);
    assert.equal(await prisma.notification.count({ where: { userId: user.id, type: "INVOICE_VOIDED" } }), 1);
    assert.equal(codeOf((await byId(voidRoute, "POST", inv.id, "/void", { reason: "Lagi-lagi" })).body), "INVOICE_VOID");
    assert.equal(codeOf((await byId(patchRoute, "PATCH", inv.id, "", { note: "x" })).body), "INVOICE_VOID");
    const restored = await byId(restoreRoute, "POST", inv.id, "/restore");
    assert.equal(restored.status, 200, JSON.stringify(restored.body));
    assert.equal(restored.body?.data.status, "UNPAID");
    const row = await prisma.invoice.findFirst({ where: { id: inv.id, schoolId: fx.school.id }, select: { voidedAt: true, voidReason: true } });
    assert.deepEqual(row, { voidedAt: null, voidReason: null });
    const again = await byId(restoreRoute, "POST", inv.id, "/restore");
    assert.equal(again.status, 409);
    assert.equal(codeOf(again.body), "INVOICE_NOT_VOID");
  });

  test("void ditolak saat bukti menunggu (409 SUBMISSION_PENDING); restore siswa PINDAH 422", async () => {
    const s = await createStudentWithToken(fx);
    const inv = await issueInvoice(fx, s.student.id, -1);
    assert.equal((await submitProof(s, inv.id, { amount: 150_000, transferDate: todayWib() })).status, 201);
    assert.equal(codeOf((await byId(voidRoute, "POST", inv.id, "/void", { reason: "Coba batal" })).body), "SUBMISSION_PENDING");
    const moved = await createStudentWithToken(fx);
    const inv2 = await issueInvoice(fx, moved.student.id, -1);
    assert.equal((await byId(voidRoute, "POST", inv2.id, "/void", { reason: "Siswa keluar" })).status, 200);
    await prisma.student.update({ where: { id: moved.student.id }, data: { status: "MOVED", activeNisn: null } });
    const res = await byId(restoreRoute, "POST", inv2.id, "/restore");
    assert.equal(res.status, 422);
    assert.equal(codeOf(res.body), "STUDENT_NOT_BILLABLE");
  });

  test("restore siswa NONAKTIF: periode depan 422 STUDENT_NOT_BILLABLE (aturan tunggakan), periode lalu boleh", async () => {
    const s = await createStudentWithToken(fx);
    const past = await issueInvoice(fx, s.student.id, -1);
    const future = await issueInvoice(fx, s.student.id, 1);
    for (const inv of [past, future]) assert.equal((await byId(voidRoute, "POST", inv.id, "/void", { reason: "Uji pemulihan" })).status, 200);
    await prisma.student.update({ where: { id: s.student.id }, data: { status: "INACTIVE" } });
    const blocked = await byId(restoreRoute, "POST", future.id, "/restore");
    assert.equal(blocked.status, 422, JSON.stringify(blocked.body));
    assert.equal(codeOf(blocked.body), "STUDENT_NOT_BILLABLE");
    assert.equal((await prisma.invoice.findUniqueOrThrow({ where: { id: future.id }, select: { status: true } })).status, "VOID");
    const allowed = await byId(restoreRoute, "POST", past.id, "/restore");
    assert.equal(allowed.status, 200, JSON.stringify(allowed.body));
  });
});
