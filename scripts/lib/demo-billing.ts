/**
 * Tagihan SPP demo Juli–September 2026 (hanya lewat seed demo: DB *_staging / *_dev / *_test).
 *
 * Dibuat lewat service SPP yang sama dengan API, dengan jam yang dimundurkan ke tanggal kejadian:
 * penagihan massal per bulan (cakupan siswa demo, idempoten lewat slot unik siswa+periode), pembayaran
 * tunai (kuitansi KWT tanpa celah, urut kronologis), dan satu bukti transfer MENUNGGU per sekolah
 * (foto sintetis lewat modul storage; dilewati dengan peringatan bila STORAGE_ROOT tak dapat ditulis).
 *
 * Idempoten: pembayaran & bukti hanya ditambahkan pada tagihan yang masih "utuh" (UNPAID, belum ada
 * pembayaran maupun bukti apa pun), sehingga perubahan admin di staging tidak pernah ditimpa.
 */
import { constants } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import sharp from "sharp";
import { bulkCreateInvoices } from "../../src/lib/billing/bulk-service";
import { recordCashPayment } from "../../src/lib/billing/payment-service";
import { bulkInvoiceBody, cashPaymentBody, submitProofBody } from "../../src/lib/billing/schemas";
import { submitPaymentProof } from "../../src/lib/billing/submission-service";
import { prisma } from "../../src/lib/db";
import { AppError } from "../../src/lib/http/errors";
import { storageRoot } from "../../src/lib/storage/driver";
import { instantAtLocal, localParts } from "../../src/lib/time/zone";
import { adminContext, clampToNow, collectDomainWarning, studentContext, type DemoSchoolRef, type DemoStudentRef } from "./demo-context";
import {
  DEMO_BILLING_PERIODS,
  DEMO_CASH_NOTE,
  DEMO_ISSUE_MINUTE,
  DEMO_TRANSFER_NOTE,
  demoCashPlan,
  demoDueDate,
  demoInvoiceOutcome,
  demoIssueDate,
} from "./demo-billing-plan";
import type { DemoSchoolSpec } from "./demo-data";

// ----------------------------------------------------------------------------- penulisan (service SPP)

interface DemoInvoiceRow {
  readonly id: string;
  readonly studentId: string;
  readonly periodYear: number;
  readonly periodMonth: number;
  readonly amount: number;
  readonly status: string;
  readonly paidAmount: number;
  readonly _count: { readonly payments: number; readonly submissions: number };
}

const periodFilter = { OR: DEMO_BILLING_PERIODS.map((p) => ({ periodYear: p.periodYear, periodMonth: p.periodMonth })) };
const demoInvoiceWhere = (ref: DemoSchoolRef) => ({ schoolId: ref.schoolId, type: "SPP" as const, studentId: { in: ref.students.map((s) => s.id) }, ...periodFilter });
const periodIndexOf = (row: Pick<DemoInvoiceRow, "periodYear" | "periodMonth">): number =>
  DEMO_BILLING_PERIODS.findIndex((p) => p.periodYear === row.periodYear && p.periodMonth === row.periodMonth);
const isUntouched = (row: DemoInvoiceRow): boolean => row.status === "UNPAID" && row.paidAmount === 0 && row._count.payments === 0 && row._count.submissions === 0;

/** Penagihan massal per bulan dengan jam = tanggal terbit (siswa yang sudah bertagihan dilewati ALREADY_BILLED). */
async function issueDemoInvoices(ref: DemoSchoolRef, spec: DemoSchoolSpec, now: Date, warnings: string[]): Promise<void> {
  const studentIds = ref.students.map((s) => s.id);
  if (studentIds.length === 0) return;
  for (const period of DEMO_BILLING_PERIODS) {
    const at = clampToNow(instantAtLocal(demoIssueDate(period), DEMO_ISSUE_MINUTE, ref.timezone), now);
    const input = bulkInvoiceBody.parse({ ...period, amount: spec.sppAmount, dueDate: demoDueDate(period), scope: { type: "STUDENTS", studentIds } });
    await collectDomainWarning(`tagihan ${period.periodYear}-${period.periodMonth}`, warnings, async () => {
      await bulkCreateInvoices(adminContext(ref, at), undefined, input);
    });
  }
}

function loadDemoInvoices(ref: DemoSchoolRef): Promise<DemoInvoiceRow[]> {
  return prisma.invoice.findMany({
    where: demoInvoiceWhere(ref),
    select: { id: true, studentId: true, periodYear: true, periodMonth: true, amount: true, status: true, paidAmount: true, _count: { select: { payments: true, submissions: true } } },
    orderBy: { invoiceNo: "asc" },
    take: ref.students.length * DEMO_BILLING_PERIODS.length,
  });
}

interface CashTask {
  readonly invoiceId: string;
  readonly amount: number;
  /** paidAmount tagihan saat tugas disusun (token konkurensi tunai). */
  readonly expectedPaidAmount: number;
  readonly at: Date;
}

function cashTasks(ref: DemoSchoolRef, invoices: readonly DemoInvoiceRow[], now: Date): CashTask[] {
  const byId = new Map(ref.students.map((s) => [s.id, s]));
  const tasks = invoices.flatMap((row) => {
    const student = byId.get(row.studentId);
    const p = periodIndexOf(row);
    const period = DEMO_BILLING_PERIODS[p];
    if (!student || !period || !isUntouched(row)) return [];
    const plan = demoCashPlan(demoInvoiceOutcome(student.index, p), row.amount, period, student.index);
    return plan ? [{ invoiceId: row.id, amount: plan.amount, expectedPaidAmount: row.paidAmount, at: clampToNow(instantAtLocal(plan.date, plan.minuteOfDay, ref.timezone), now) }] : [];
  });
  return tasks.sort((a, b) => a.at.getTime() - b.at.getTime() || (a.invoiceId < b.invoiceId ? -1 : 1));
}

/** Tunai dengan jam = tanggal bayar; urut kronologis agar nomor kuitansi mengikuti tanggal. */
async function recordDemoCashPayments(ref: DemoSchoolRef, invoices: readonly DemoInvoiceRow[], now: Date, warnings: string[]): Promise<void> {
  for (const task of cashTasks(ref, invoices, now)) {
    const input = cashPaymentBody.parse({ amount: task.amount, paidDate: localParts(task.at, ref.timezone).ymd, note: DEMO_CASH_NOTE, expectedPaidAmount: task.expectedPaidAmount });
    await collectDomainWarning(`tunai ${task.invoiceId}`, warnings, async () => {
      await recordCashPayment(adminContext(ref, task.at), undefined, task.invoiceId, input);
    });
  }
}

/** null bila STORAGE_ROOT dapat ditulis; selain itu alasannya. */
export async function storageProblem(): Promise<string | null> {
  try {
    const root = storageRoot();
    await mkdir(root, { recursive: true });
    await access(root, constants.W_OK);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Foto bukti sintetis (kop berwarna + baris "teks" abu-abu), deterministik per sekolah. */
export async function demoProofImage(seed: number): Promise<Uint8Array<ArrayBuffer>> {
  const [width, height] = [480, 720];
  const pixels = Buffer.alloc(width * height * 3, 255);
  const paint = (x0: number, y0: number, w: number, h: number, rgb: readonly [number, number, number]) => {
    for (let y = y0; y < Math.min(height, y0 + h); y += 1) {
      for (let x = x0; x < Math.min(width, x0 + w); x += 1) pixels.set(rgb, (y * width + x) * 3);
    }
  };
  paint(0, 0, width, 110, [20 + (seed * 37) % 60, 70 + (seed * 53) % 90, 140 + (seed * 29) % 100]);
  for (let line = 0; line < 14; line += 1) paint(40, 150 + line * 36, 120 + ((seed + line * 97) % 280), 14, [150, 150, 150]);
  paint(40, 660, 400, 30, [40, 160, 90]);
  return Uint8Array.from(await sharp(pixels, { raw: { width, height, channels: 3 } }).jpeg({ quality: 80 }).toBuffer());
}

async function submitProof(ref: DemoSchoolRef, student: DemoStudentRef, row: DemoInvoiceRow, spec: DemoSchoolSpec, now: Date): Promise<void> {
  const bytes = await demoProofImage(Number(spec.npsn.slice(-2)));
  const input = submitProofBody.parse({
    amount: String(row.amount - row.paidAmount),
    transferDate: localParts(now, ref.timezone).ymd,
    senderName: spec.students[student.index]?.guardianName ?? student.name,
    senderBank: spec.bank.bankName,
    note: DEMO_TRANSFER_NOTE,
    file: new File([bytes], "bukti-transfer-demo.jpg", { type: "image/jpeg" }),
  });
  await submitPaymentProof(studentContext(ref, student, now), row.id, input);
}

/** Satu bukti transfer MENUNGGU verifikasi (siswa pertama, September). */
async function submitDemoTransfer(ref: DemoSchoolRef, spec: DemoSchoolSpec, invoices: readonly DemoInvoiceRow[], now: Date, warnings: string[]): Promise<void> {
  const byId = new Map(ref.students.map((s) => [s.id, s]));
  const target = invoices.find((row) => {
    const student = byId.get(row.studentId);
    return student !== undefined && isUntouched(row) && demoInvoiceOutcome(student.index, periodIndexOf(row)) === "PENDING_TRANSFER";
  });
  const student = target ? byId.get(target.studentId) : undefined;
  if (!target || !student) return;
  const problem = await storageProblem();
  if (problem) {
    warnings.push(`bukti transfer demo dilewati: STORAGE_ROOT tidak dapat ditulis (${problem})`);
    return;
  }
  try {
    await submitProof(ref, student, target, spec, now);
  } catch (error) {
    // Guard disk (<5 GB bebas -> 503) & pelanggaran aturan: peringatan, bukan kegagalan seed.
    if (!(error instanceof AppError)) throw error;
    warnings.push(`bukti transfer demo: ${error.code} ${error.message}`);
  }
}

export interface DemoBillingSummary {
  readonly invoices: number;
  readonly paid: number;
  readonly partial: number;
  readonly unpaid: number;
  /** Pembayaran tidak dibatalkan (= kuitansi aktif). */
  readonly payments: number;
  readonly pendingSubmissions: number;
}

async function summarizeDemoBilling(ref: DemoSchoolRef): Promise<DemoBillingSummary> {
  const where = demoInvoiceWhere(ref);
  const [groups, payments, pendingSubmissions] = await Promise.all([
    prisma.invoice.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.payment.count({ where: { schoolId: ref.schoolId, voidedAt: null, invoice: where } }),
    prisma.paymentSubmission.count({ where: { schoolId: ref.schoolId, status: "PENDING", invoice: where } }),
  ]);
  const count = (status: string) => groups.find((g) => g.status === status)?._count._all ?? 0;
  const invoices = groups.reduce((sum, g) => sum + g._count._all, 0);
  return { invoices, paid: count("PAID"), partial: count("PARTIAL"), unpaid: count("UNPAID"), payments, pendingSubmissions };
}

/** Pastikan tagihan, pembayaran tunai, dan satu bukti menunggu verifikasi untuk siswa demo satu sekolah. */
export async function ensureDemoBilling(ref: DemoSchoolRef, spec: DemoSchoolSpec, now: Date, warnings: string[]): Promise<DemoBillingSummary> {
  await issueDemoInvoices(ref, spec, now, warnings);
  const invoices = await loadDemoInvoices(ref);
  await recordDemoCashPayments(ref, invoices, now, warnings);
  await submitDemoTransfer(ref, spec, invoices, now, warnings);
  return summarizeDemoBilling(ref);
}
