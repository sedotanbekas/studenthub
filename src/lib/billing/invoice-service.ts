import { writeAudit } from "@/lib/audit";
import type { ActionContext } from "@/lib/auth/principal";
import { prisma, type Tx } from "@/lib/db";
import { notifyStudents } from "@/lib/notifications/notify";
import { invoiceIssuedNotification } from "@/lib/notifications/templates/billing";
import { uniqueIndexOf } from "@/lib/students/unique-error";
import { toDbDate } from "@/lib/time/zone";
import { withTx } from "@/lib/tx";
import { billingScopeOf, loadBillingSchool, schoolClock, type SchoolClock } from "./context";
import { allocateDocumentNumbers, lockDocumentCounter } from "./counter";
import { assertBilling, billingError, violation } from "./errors";
import { invoiceEditViolation, restoreViolation, voidViolation } from "./invoice-edit-rules";
import { loadInvoiceDto } from "./invoice-queries";
import { findInvoiceOwner, readInvoiceState, stateChanged, writeInvoiceVoid, type InvoiceState } from "./invoice-state";
import { lockStudentAndInvoice, lockStudentShared, studentNotFound } from "./locks";
import { billableViolation, defaultDueDate, invoiceTitle, periodKey, validateDueDate, validatePeriod } from "./period-rules";
import type { InvoiceDto } from "./response-schemas";
import type { CreateInvoiceInput, ReasonInput, UpdateInvoiceInput } from "./schemas";

/**
 * Mutasi satu tagihan oleh admin. Urutan kunci: Student (bersama) -> Invoice (eksklusif) -> DocumentCounter;
 * Notification & AuditLog terakhir. Transisi status memakai compare-and-set (updateMany + status lama).
 */
const SLOT_INDEX = "Invoice_studentId_type_periodYear_periodMonth_key";

const invoiceExists = (existing: { id: string; invoiceNo: string; status: string }) =>
  billingError(
    violation(
      "INVOICE_EXISTS",
      existing.status === "VOID"
        ? `Tagihan periode ini sudah ada (${existing.invoiceNo}, dibatalkan). Pulihkan tagihan tersebut bila ingin menagih lagi.`
        : `Tagihan periode ini sudah ada (${existing.invoiceNo}).`,
      { invoiceId: existing.id, invoiceNo: existing.invoiceNo, status: existing.status, hint: existing.status === "VOID" ? "RESTORE" : null },
    ),
  );

/** P2002 pada slot unik (balapan lintas tahun penghitung) -> 409 INVOICE_EXISTS tanpa detail. */
async function withSlotConflict<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (uniqueIndexOf(error) === SLOT_INDEX) throw billingError(violation("INVOICE_EXISTS", "Tagihan periode ini sudah ada."));
    throw error;
  }
}

interface SlotKey {
  readonly schoolId: string;
  readonly studentId: string;
  readonly periodYear: number;
  readonly periodMonth: number;
}

async function assertSlotFree(tx: Tx, slot: SlotKey): Promise<void> {
  const existing = await tx.invoice.findFirst({
    where: { schoolId: slot.schoolId, studentId: slot.studentId, type: "SPP", periodYear: slot.periodYear, periodMonth: slot.periodMonth },
    select: { id: true, invoiceNo: true, status: true },
  });
  if (existing) throw invoiceExists(existing);
}

interface NewInvoice {
  readonly input: CreateInvoiceInput;
  readonly schoolId: string;
  readonly clock: SchoolClock;
  readonly dueDate: string;
  readonly title: string;
}

async function insertInvoice(tx: Tx, plan: NewInvoice, ctx: ActionContext): Promise<string> {
  const { input, schoolId, clock } = plan;
  await lockStudentShared(tx, schoolId, input.studentId);
  const student = await tx.student.findFirst({ where: { id: input.studentId, schoolId }, select: { id: true, status: true } });
  if (!student) throw studentNotFound();
  assertBilling(billableViolation(student.status, periodKey(input.periodYear, input.periodMonth), clock.todayKey));
  const counter = { schoolId, kind: "INVOICE" as const, year: clock.year };
  await lockDocumentCounter(tx, counter, ctx.now);
  await assertSlotFree(tx, { schoolId, studentId: student.id, periodYear: input.periodYear, periodMonth: input.periodMonth });
  const [invoiceNo = ""] = (await allocateDocumentNumbers(tx, counter, 1, ctx.now)).numbers;
  const invoice = await tx.invoice.create({
    data: {
      schoolId, studentId: student.id, invoiceNo, periodYear: input.periodYear, periodMonth: input.periodMonth, title: plan.title,
      amount: input.amount, dueDate: toDbDate(plan.dueDate), note: input.note ?? null, createdAt: ctx.now,
    },
    select: { id: true },
  });
  if (input.notify) {
    const event = invoiceIssuedNotification({ invoiceId: invoice.id, title: plan.title, amount: input.amount, dueDate: plan.dueDate });
    await notifyStudents(tx, [student.id], event, ctx);
  }
  const after = { invoiceNo, studentId: student.id, period: `${input.periodYear}-${input.periodMonth}`, amount: input.amount, dueDate: plan.dueDate };
  await writeAudit(tx, { action: "invoice.create", entityType: "Invoice", entityId: invoice.id, schoolId, after }, ctx);
  return invoice.id;
}

/** POST /school/invoices: satu tagihan (siswa ACTIVE; INACTIVE/GRADUATED hanya tunggakan). */
export async function createInvoice(ctx: ActionContext, schoolId: string | undefined, input: CreateInvoiceInput): Promise<InvoiceDto> {
  const scope = billingScopeOf(ctx, schoolId);
  const school = await loadBillingSchool(prisma, scope.schoolId);
  const clock = schoolClock(school, ctx.now);
  assertBilling(validatePeriod(input.periodYear, input.periodMonth, clock.today));
  const dueDate = input.dueDate ?? defaultDueDate(input.periodYear, input.periodMonth);
  assertBilling(validateDueDate(dueDate, input.periodYear, input.periodMonth));
  const title = input.title ?? invoiceTitle(input.periodYear, input.periodMonth);
  const plan: NewInvoice = { input, schoolId: scope.schoolId, clock, dueDate, title };
  const id = await withSlotConflict(() => withTx((tx) => insertInvoice(tx, plan, ctx)));
  return loadInvoiceDto(prisma, scope.schoolId, id, clock.today);
}

/** Kunci Student (bersama) + Invoice lalu baca ulang status tagihan. */
async function lockAndRead(tx: Tx, owner: { id: string; studentId: string }, schoolId: string): Promise<InvoiceState> {
  await lockStudentAndInvoice(tx, { id: owner.id, schoolId, studentId: owner.studentId });
  return readInvoiceState(tx, schoolId, owner.id);
}

function patchData(patch: UpdateInvoiceInput) {
  return {
    ...(patch.amount !== undefined ? { amount: patch.amount } : {}),
    ...(patch.dueDate !== undefined ? { dueDate: toDbDate(patch.dueDate) } : {}),
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.note !== undefined ? { note: patch.note } : {}),
  };
}

/** PATCH /school/invoices/{id}: VOID tidak bisa; PAID hanya catatan; nominal hanya UNPAID tanpa bukti menunggu. */
export async function updateInvoice(ctx: ActionContext, schoolId: string | undefined, id: string, patch: UpdateInvoiceInput): Promise<InvoiceDto> {
  const scope = billingScopeOf(ctx, schoolId);
  const school = await loadBillingSchool(prisma, scope.schoolId);
  const owner = await findInvoiceOwner(prisma, scope.schoolId, id);
  await withTx(async (tx) => {
    const invoice = await lockAndRead(tx, owner, scope.schoolId);
    assertBilling(invoiceEditViolation({ status: invoice.status, hasPending: invoice.pendingSubmissionId !== null }, patch));
    if (patch.dueDate !== undefined) assertBilling(validateDueDate(patch.dueDate, invoice.periodYear, invoice.periodMonth));
    const updated = await tx.invoice.updateMany({ where: { id, schoolId: scope.schoolId, status: invoice.status }, data: patchData(patch) });
    if (updated.count !== 1) throw stateChanged();
    const before = { amount: invoice.amount, dueDate: invoice.dueDate, title: invoice.title, note: invoice.note };
    await writeAudit(tx, { action: "invoice.update", entityType: "Invoice", entityId: id, schoolId: scope.schoolId, before, after: patch }, ctx);
  });
  return loadInvoiceDto(prisma, scope.schoolId, id, schoolClock(school, ctx.now).today);
}

/** POST /school/invoices/{id}/void: hanya UNPAID tanpa bayar & tanpa bukti menunggu. */
export async function voidInvoice(ctx: ActionContext, schoolId: string | undefined, id: string, input: ReasonInput): Promise<InvoiceDto> {
  const scope = billingScopeOf(ctx, schoolId);
  const school = await loadBillingSchool(prisma, scope.schoolId);
  const owner = await findInvoiceOwner(prisma, scope.schoolId, id);
  await withTx(async (tx) => {
    const invoice = await lockAndRead(tx, owner, scope.schoolId);
    assertBilling(voidViolation({ status: invoice.status, paidAmount: invoice.paidAmount, hasPending: invoice.pendingSubmissionId !== null }));
    await writeInvoiceVoid(tx, { invoice, reason: input.reason, source: "admin" }, ctx);
  });
  return loadInvoiceDto(prisma, scope.schoolId, id, schoolClock(school, ctx.now).today);
}

/** POST /school/invoices/{id}/restore: VOID -> UNPAID (siswa tidak PINDAH; nonaktif/lulus hanya tunggakan). */
export async function restoreInvoice(ctx: ActionContext, schoolId: string | undefined, id: string): Promise<InvoiceDto> {
  const scope = billingScopeOf(ctx, schoolId);
  const school = await loadBillingSchool(prisma, scope.schoolId);
  const owner = await findInvoiceOwner(prisma, scope.schoolId, id);
  await withTx(async (tx) => {
    const invoice = await lockAndRead(tx, owner, scope.schoolId);
    const student = await tx.student.findFirst({ where: { id: invoice.studentId, schoolId: scope.schoolId }, select: { status: true } });
    if (!student) throw studentNotFound();
    const period = periodKey(invoice.periodYear, invoice.periodMonth);
    assertBilling(restoreViolation({ status: invoice.status, periodKey: period }, student.status, schoolClock(school, ctx.now).todayKey));
    const updated = await tx.invoice.updateMany({
      where: { id, schoolId: scope.schoolId, status: "VOID" },
      data: { status: "UNPAID", voidedAt: null, voidedById: null, voidReason: null },
    });
    if (updated.count !== 1) throw stateChanged();
    const audit = { action: "invoice.restore", entityType: "Invoice", entityId: id, schoolId: scope.schoolId, before: { status: "VOID" }, after: { status: "UNPAID" } };
    await writeAudit(tx, audit, ctx);
  });
  return loadInvoiceDto(prisma, scope.schoolId, id, schoolClock(school, ctx.now).today);
}
