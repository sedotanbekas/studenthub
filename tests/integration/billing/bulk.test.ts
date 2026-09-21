/**
 * Tagihan massal: idempoten & nomor bersambung, dry run tanpa tulisan, tarif (override > sppAmount > default,
 * 0 = EXEMPT), cakupan kelas/siswa, chunk 200 per transaksi, dua penagihan bersamaan.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { POST as bulkRoute } from "@/app/api/v1/school/invoices/bulk/route";
import { parseDocumentNumber } from "@/lib/billing/document-number";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { disconnect, prisma, uniq } from "../helpers/db";
import { hashTestPassword, uniqNisn } from "../helpers/factories";
import { callRoute, type Envelope } from "../helpers/request";
import { createBillingSchool, createStudentWithToken, periodAt, schoolUrl, type BillingFixture } from "./fixtures";

interface BulkBody {
  readonly dryRun: boolean;
  readonly created: number;
  readonly totalAmount: number;
  readonly invoiceNoFrom: string | null;
  readonly invoiceNoTo: string | null;
  readonly skippedCount: number;
  readonly skipped: Array<{ studentId: string; reason: string }>;
}

let other: BillingFixture;
before(async () => {
  other = await createBillingSchool();
});
beforeEach(() => resetAllLimiters());
after(disconnect);

const bulk = (fx: BillingFixture, json: Record<string, unknown>, token = fx.adminToken) =>
  callRoute<Envelope<BulkBody>>(bulkRoute, { method: "POST", url: schoolUrl("/invoices/bulk"), bearer: token, json: { ...periodAt(1), amount: 150_000, scope: { type: "SCHOOL" }, ...json } });

const seqOf = (no: string | null | undefined): number => parseDocumentNumber(no ?? "")?.seq ?? -1;

async function invoiceNumbers(schoolId: string): Promise<number[]> {
  const rows = await prisma.invoice.findMany({ where: { schoolId }, select: { invoiceNo: true } });
  return rows.map((r) => seqOf(r.invoiceNo)).sort((a, b) => a - b);
}

const range = (from: number, count: number): number[] => Array.from({ length: count }, (_, i) => from + i);

describe("tagihan massal", () => {
  test("tarif per siswa, EXEMPT, siswa tidak aktif diabaikan; menjalankan ulang idempoten & nomor bersambung", async () => {
    const fx = await createBillingSchool();
    const plain = await createStudentWithToken(fx);
    const custom = await createStudentWithToken(fx, { data: { sppAmount: 90_000 } });
    const exempt = await createStudentWithToken(fx, { data: { sppAmount: 0 } });
    const overridden = await createStudentWithToken(fx, { data: { sppAmount: 90_000 } });
    const inactive = await createStudentWithToken(fx, { status: "INACTIVE" });
    const first = await bulk(fx, { overrides: [{ studentId: overridden.student.id, amount: 60_000 }] });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.deepEqual([first.body?.data.created, first.body?.data.totalAmount, first.body?.data.dryRun], [3, 300_000, false]);
    assert.deepEqual(first.body?.data.skipped, [{ studentId: exempt.student.id, reason: "EXEMPT" }]);
    assert.deepEqual([seqOf(first.body?.data.invoiceNoFrom), seqOf(first.body?.data.invoiceNoTo)], [1, 3]);
    const amounts = await prisma.invoice.findMany({ where: { schoolId: fx.school.id }, select: { studentId: true, amount: true } });
    const byStudent = new Map(amounts.map((a) => [a.studentId, a.amount]));
    assert.deepEqual([byStudent.get(plain.student.id), byStudent.get(custom.student.id), byStudent.get(overridden.student.id)], [150_000, 90_000, 60_000]);
    assert.equal(byStudent.has(inactive.student.id), false);
    for (const s of [plain, custom, overridden]) {
      assert.equal(await prisma.notification.count({ where: { userId: s.user.id, type: "INVOICE_ISSUED" } }), 1);
    }
    const second = await bulk(fx, {});
    assert.equal(second.status, 200);
    assert.equal(second.body?.data.created, 0);
    assert.equal(second.body?.data.invoiceNoFrom, null);
    assert.deepEqual(second.body?.data.skipped.map((s) => s.reason).sort(), ["ALREADY_BILLED", "ALREADY_BILLED", "ALREADY_BILLED", "EXEMPT"]);
    assert.deepEqual(await invoiceNumbers(fx.school.id), [1, 2, 3]);
    // Chunk tanpa tagihan baru tidak menulis apa pun (termasuk audit).
    assert.equal(await prisma.auditLog.count({ where: { schoolId: fx.school.id, action: "invoice.bulk_create" } }), 1);
  });

  test("dryRun tidak menulis tagihan, penghitung, maupun notifikasi", async () => {
    const fx = await createBillingSchool();
    const s = await createStudentWithToken(fx);
    await createStudentWithToken(fx);
    const res = await bulk(fx, { dryRun: true });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual([res.body?.data.dryRun, res.body?.data.created, res.body?.data.totalAmount, res.body?.data.invoiceNoFrom], [true, 2, 300_000, null]);
    assert.equal(await prisma.invoice.count({ where: { schoolId: fx.school.id } }), 0);
    assert.equal(await prisma.documentCounter.count({ where: { schoolId: fx.school.id } }), 0);
    assert.equal(await prisma.notification.count({ where: { userId: s.user.id } }), 0);
  });

  test("cakupan CLASSES & STUDENTS (NOT_ACTIVE); kelas/siswa sekolah lain 404; override di luar cakupan 422", async () => {
    const fx = await createBillingSchool();
    const inClass = await createStudentWithToken(fx);
    const noClass = await createStudentWithToken(fx, { classId: null });
    const graduated = await createStudentWithToken(fx, { status: "GRADUATED" });
    const byClass = await bulk(fx, { scope: { type: "CLASSES", classIds: [fx.klass.id] } });
    assert.equal(byClass.body?.data.created, 1);
    assert.equal(await prisma.invoice.count({ where: { studentId: noClass.student.id } }), 0);
    const byStudents = await bulk(fx, { ...periodAt(2), scope: { type: "STUDENTS", studentIds: [noClass.student.id, graduated.student.id] } });
    assert.equal(byStudents.body?.data.created, 1);
    assert.deepEqual(byStudents.body?.data.skipped, [{ studentId: graduated.student.id, reason: "NOT_ACTIVE" }]);
    assert.equal((await bulk(fx, { scope: { type: "CLASSES", classIds: [other.klass.id] } })).status, 404);
    const foreign = await createStudentWithToken(other);
    assert.equal((await bulk(fx, { scope: { type: "STUDENTS", studentIds: [foreign.student.id] } })).status, 404);
    const outside = await bulk(fx, { ...periodAt(3), scope: { type: "CLASSES", classIds: [fx.klass.id] }, overrides: [{ studentId: noClass.student.id, amount: 0 }] });
    assert.equal(outside.status, 422);
    assert.equal(outside.body?.error?.code, "BULK_OVERRIDE_OUT_OF_SCOPE");
    assert.equal(await prisma.invoice.count({ where: { studentId: inClass.student.id } }), 1);
  });

  test("400 validasi (cakupan kosong, override ganda, dryRun bukan boolean); 403 siswa", async () => {
    const fx = await createBillingSchool();
    const s = await createStudentWithToken(fx);
    for (const json of [
      { scope: { type: "CLASSES", classIds: [] } },
      { overrides: [{ studentId: s.student.id, amount: 0 }, { studentId: s.student.id, amount: 50_000 }] },
      { dryRun: "ya" },
      { overrides: [{ studentId: s.student.id, amount: 500 }] },
    ]) {
      assert.equal((await bulk(fx, json)).status, 400, JSON.stringify(json));
    }
    assert.equal((await bulk(fx, {}, s.token)).status, 403);
  });

  test("dua penagihan identik bersamaan: total N, nomor unik & bersambung", async () => {
    const fx = await createBillingSchool();
    for (let i = 0; i < 6; i += 1) await createStudentWithToken(fx);
    const [a, b] = await Promise.all([bulk(fx, {}), bulk(fx, {})]);
    assert.deepEqual([a.status, b.status], [200, 200], JSON.stringify([a.body, b.body]));
    assert.equal((a.body?.data.created ?? 0) + (b.body?.data.created ?? 0), 6);
    assert.deepEqual(await invoiceNumbers(fx.school.id), range(1, 6));
  });
});

/** 201 siswa aktif langsung lewat createMany (factory satu-per-satu terlalu lambat). */
async function seedActiveStudents(fx: BillingFixture, count: number): Promise<void> {
  const passwordHash = await hashTestPassword();
  const ids = Array.from({ length: count }, () => `bulk-${randomBytes(10).toString("hex")}`);
  await prisma.user.createMany({ data: ids.map((id, i) => ({ id, role: "STUDENT" as const, name: `Siswa Massal ${String(i).padStart(3, "0")}`, passwordHash, schoolId: fx.school.id })) });
  await prisma.student.createMany({
    data: ids.map((userId) => {
      const nisn = uniqNisn();
      return {
        userId, schoolId: fx.school.id, nisn, activeNisn: nisn, nis: uniq("m").slice(0, 20), gender: "FEMALE" as const, status: "ACTIVE" as const,
        currentClassId: fx.klass.id, activatedAt: new Date(Date.now() - 40 * 86_400_000),
      };
    }),
  });
}

describe("chunk 200 per transaksi", () => {
  test("201 siswa -> 2 chunk (2 audit), 201 tagihan bernomor 1..201", async () => {
    const fx = await createBillingSchool();
    await seedActiveStudents(fx, 201);
    const res = await bulk(fx, { notify: false });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual([res.body?.data.created, seqOf(res.body?.data.invoiceNoFrom), seqOf(res.body?.data.invoiceNoTo)], [201, 1, 201]);
    assert.deepEqual(await invoiceNumbers(fx.school.id), range(1, 201));
    assert.equal(await prisma.auditLog.count({ where: { schoolId: fx.school.id, action: "invoice.bulk_create" } }), 2);
  });
});
