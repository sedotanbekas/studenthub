/**
 * Kait siswa PINDAH (lewat POST /school/students/{id}/status) & statistik dashboard SPP (billingStats).
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { POST as cashRoute } from "@/app/api/v1/school/invoices/[id]/payments/route";
import { POST as statusRoute } from "@/app/api/v1/school/students/[id]/status/route";
import { billingStats } from "@/lib/billing/stats";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { resolveSchoolScope } from "@/lib/tenant/scope";
import { makePrincipal } from "@/lib/auth/test-principal";
import { toDbDate } from "@/lib/time/zone";
import { disconnect, prisma, uniq } from "../helpers/db";
import { createStudent } from "../helpers/factories";
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

describe("siswa PINDAH me-void tagihan masa depan", () => {
  test("hanya UNPAID berperiode > bulan ini tanpa bukti menunggu; tunggakan & bulan ini tetap", async () => {
    const s = await createStudentWithToken(fx);
    const past = await issueInvoice(fx, s.student.id, -1);
    const current = await issueInvoice(fx, s.student.id, 0);
    const future = await issueInvoice(fx, s.student.id, 1);
    const futurePending = await issueInvoice(fx, s.student.id, 2);
    const futurePartial = await issueInvoice(fx, s.student.id, 3, 150_000);
    assert.equal((await submitProof(s, futurePending.id, { amount: 50_000 })).status, 201);
    const pay = await callRoute(cashRoute, {
      method: "POST", url: schoolUrl(`/invoices/${futurePartial.id}/payments`), params: { id: futurePartial.id }, bearer: fx.adminToken, json: { amount: 50_000, paidDate: todayWib() },
    });
    assert.equal(pay.status, 201);
    const res = await callRoute<Envelope<{ voidedInvoiceIds: string[] }>>(statusRoute, {
      method: "POST", url: schoolUrl(`/students/${s.student.id}/status`), params: { id: s.student.id }, bearer: fx.adminToken, json: { to: "MOVED", reason: "Pindah ke luar kota" },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body?.data.voidedInvoiceIds, [future.id]);
    const rows = await prisma.invoice.findMany({ where: { studentId: s.student.id }, select: { id: true, status: true, voidReason: true } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    assert.deepEqual([past, current, futurePending, futurePartial].map((i) => byId.get(i.id)?.status), ["UNPAID", "UNPAID", "UNPAID", "PARTIAL"]);
    assert.deepEqual([byId.get(future.id)?.status, byId.get(future.id)?.voidReason], ["VOID", "Pindah ke luar kota"]);
    const audit = await prisma.auditLog.findFirst({ where: { action: "invoice.void", entityId: future.id } });
    assert.equal((audit?.after as { source?: string } | null)?.source, "student_moved");
  });
});

interface SeedInvoice {
  readonly studentId: string;
  readonly periodYear: number;
  readonly periodMonth: number;
  readonly dueDate: string;
  readonly amount?: number;
  readonly paidAmount?: number;
  readonly status?: "UNPAID" | "PARTIAL" | "PAID" | "VOID";
}

async function seed(schoolId: string, inv: SeedInvoice): Promise<void> {
  await prisma.invoice.create({
    data: {
      schoolId, studentId: inv.studentId, invoiceNo: uniq("T").slice(0, 20), periodYear: inv.periodYear, periodMonth: inv.periodMonth,
      title: "SPP Uji", amount: inv.amount ?? 100_000, paidAmount: inv.paidAmount ?? 0, status: inv.status ?? "UNPAID", dueDate: toDbDate(inv.dueDate),
    },
  });
}

const scopeOf = (schoolId: string) => resolveSchoolScope(makePrincipal({ role: "SCHOOL_ADMIN", schoolId }));

describe("billingStats", () => {
  // Jam uji tetap: 2026-09-10 15:30 UTC = 22:30 WIB (masih 10 Sep) = 00:30 WIT (sudah 11 Sep).
  const NOW = new Date("2026-09-10T15:30:00Z");

  async function statsSchool(timezone: "WIB" | "WIT"): Promise<string> {
    const school = await createBillingSchool({ timezone });
    const id = school.school.id;
    const active = (await createStudent(id)).student.id;
    const active2 = (await createStudent(id)).student.id;
    const inactive = (await createStudent(id, { status: "INACTIVE" })).student.id;
    await seed(id, { studentId: active, periodYear: 2026, periodMonth: 9, dueDate: "2026-09-10" });
    await seed(id, { studentId: active, periodYear: 2026, periodMonth: 8, dueDate: "2026-08-10", paidAmount: 40_000, status: "PARTIAL" });
    await seed(id, { studentId: active2, periodYear: 2026, periodMonth: 10, dueDate: "2026-10-10" });
    await seed(id, { studentId: active2, periodYear: 2026, periodMonth: 9, dueDate: "2026-09-10", status: "VOID" });
    await seed(id, { studentId: inactive, periodYear: 2026, periodMonth: 7, dueDate: "2026-07-10" });
    await seed(id, { studentId: inactive, periodYear: 2026, periodMonth: 9, dueDate: "2026-09-10", paidAmount: 100_000, status: "PAID" });
    return id;
  }

  test("mengecualikan bulan mendatang, VOID, siswa tidak aktif; jatuh tempo mengikuti zona waktu sekolah (WIB vs WIT)", async () => {
    const wib = await billingStats(scopeOf(await statsSchool("WIB")), { periodYear: 2026, periodMonth: 9 }, NOW);
    assert.deepEqual([wib.studentsNotFullyPaid, wib.outstandingAmount, wib.pendingVerification], [1, 160_000, 0]);
    assert.equal(wib.studentsOverdue, 1, "WIB: tagihan Agustus sudah lewat, September belum");
    assert.deepEqual(wib.period, {
      periodYear: 2026, periodMonth: 9, invoiced: 2, paid: 1, partial: 0, unpaid: 1, void: 1, billedAmount: 200_000, collectedAmount: 100_000,
    });
    const witSchool = await statsSchool("WIT");
    const wit = await billingStats(scopeOf(witSchool), {}, NOW);
    assert.deepEqual([wit.studentsNotFullyPaid, wit.studentsOverdue, wit.period], [1, 1, null]);
    // Di WIT hari sudah 11 Sep: siswa aktif kedua tetap tidak dihitung (tagihannya Oktober / VOID).
    const onlySept = await createStudent(witSchool);
    await seed(witSchool, { studentId: onlySept.student.id, periodYear: 2026, periodMonth: 9, dueDate: "2026-09-10" });
    const witAfter = await billingStats(scopeOf(witSchool), {}, NOW);
    assert.deepEqual([witAfter.studentsNotFullyPaid, witAfter.studentsOverdue], [2, 2]);
    const wibSchool = await statsSchool("WIB");
    const onlySeptWib = await createStudent(wibSchool);
    await seed(wibSchool, { studentId: onlySeptWib.student.id, periodYear: 2026, periodMonth: 9, dueDate: "2026-09-10" });
    const wibAfter = await billingStats(scopeOf(wibSchool), {}, NOW);
    assert.deepEqual([wibAfter.studentsNotFullyPaid, wibAfter.studentsOverdue], [2, 1]);
  });
});
