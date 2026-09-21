import type { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import type { ActionContext } from "@/lib/auth/principal";
import { prisma, type Tx } from "@/lib/db";
import { AppError, notFound } from "@/lib/http/errors";
import { notifyStudents } from "@/lib/notifications/notify";
import { bulkInvoiceIssuedNotification } from "@/lib/notifications/templates/billing";
import { toDbDate, type LocalDate } from "@/lib/time/zone";
import { withTx } from "@/lib/tx";
import { chunk, overrideScopeViolation, planBulkInvoices, sortBulkStudents, type BulkRow, type BulkSkip, type BulkStudent } from "./bulk-plan";
import { BULK_CHUNK_SIZE, BULK_TX_TIMEOUT_MS, MAX_BULK_INVOICE_STUDENTS, MAX_BULK_SKIPPED_LISTED } from "./constants";
import { billingScopeOf, loadBillingSchool, schoolClock } from "./context";
import { allocateDocumentNumbers, lockDocumentCounter } from "./counter";
import { assertBilling, violation } from "./errors";
import { lockStudentsShared } from "./locks";
import { defaultDueDate, invoiceTitle, validateDueDate, validatePeriod } from "./period-rules";
import type { BulkResultDto } from "./response-schemas";
import type { BulkInvoiceInput, BulkScope } from "./schemas";

/**
 * Tagihan massal satu periode. Rencana dibuat per chunk 200 siswa di DALAM transaksinya sendiri:
 * Student (bersama, id naik) -> baca ulang status & tarif -> kunci DocumentCounter INVOICE -> cek slot yang
 * sudah ada (VOID termasuk) -> alokasi nomor -> createMany TANPA skipDuplicates (INSERT IGNORE MariaDB juga
 * menelan pelanggaran CHECK/FK) -> notifikasi (createMany per nominal) -> audit. Menjalankan ulang = idempoten.
 */
interface BulkContext {
  readonly schoolId: string;
  readonly year: number;
  readonly input: BulkInvoiceInput;
  readonly dueDate: LocalDate;
  readonly title: string;
  readonly overrides: ReadonlyMap<string, number>;
}

interface ChunkOutcome {
  readonly created: number;
  readonly totalAmount: number;
  readonly invoiceNoFrom: string | null;
  readonly invoiceNoTo: string | null;
  readonly skipped: readonly BulkSkip[];
}

const STUDENT_SELECT = {
  id: true, status: true, sppAmount: true, user: { select: { name: true } }, currentClass: { select: { name: true } },
} as const satisfies Prisma.StudentSelect;

function scopeWhere(schoolId: string, scope: BulkScope): Prisma.StudentWhereInput {
  if (scope.type === "STUDENTS") return { schoolId, id: { in: scope.studentIds } };
  if (scope.type === "CLASSES") return { schoolId, status: "ACTIVE", currentClassId: { in: scope.classIds } };
  return { schoolId, status: "ACTIVE" };
}

/** Siswa dalam cakupan: ACTIVE (SCHOOL/CLASSES) atau semua yang disebut (STUDENTS; non-aktif -> NOT_ACTIVE). */
async function loadScopeStudents(schoolId: string, scope: BulkScope): Promise<BulkStudent[]> {
  const rows = await prisma.student.findMany({ where: scopeWhere(schoolId, scope), select: STUDENT_SELECT, take: MAX_BULK_INVOICE_STUDENTS + 1 });
  if (rows.length > MAX_BULK_INVOICE_STUDENTS) {
    assertBilling(violation("BULK_TOO_LARGE", `Maksimal ${MAX_BULK_INVOICE_STUDENTS} siswa per penagihan massal. Bagi per kelas.`, { max: MAX_BULK_INVOICE_STUDENTS }));
  }
  return rows.map((r) => ({ id: r.id, name: r.user.name, className: r.currentClass?.name ?? null, sppAmount: r.sppAmount, status: r.status }));
}

async function assertScopeExists(schoolId: string, scope: BulkScope, students: readonly BulkStudent[]): Promise<void> {
  if (scope.type === "CLASSES") {
    const found = await prisma.schoolClass.count({ where: { schoolId, id: { in: scope.classIds } } });
    if (found !== scope.classIds.length) throw notFound("Kelas tidak ditemukan.", "CLASS_NOT_FOUND");
  }
  if (scope.type === "STUDENTS") {
    const known = new Set(students.map((s) => s.id));
    const missing = scope.studentIds.filter((id) => !known.has(id));
    if (missing.length > 0) throw new AppError(404, "NOT_FOUND", "Sebagian siswa tidak ditemukan.", { studentIds: missing.slice(0, 50) });
  }
}

/** Override hanya untuk siswa dalam cakupan (status apa pun) -> 422 BULK_OVERRIDE_OUT_OF_SCOPE. */
async function assertOverridesInScope(schoolId: string, scope: BulkScope, overrideIds: readonly string[]): Promise<void> {
  if (overrideIds.length === 0) return;
  const wanted = new Set(overrideIds);
  const where: Prisma.StudentWhereInput =
    scope.type === "STUDENTS"
      ? { schoolId, id: { in: scope.studentIds.filter((id) => wanted.has(id)) } }
      : { schoolId, id: { in: [...wanted] }, ...(scope.type === "CLASSES" ? { currentClassId: { in: scope.classIds } } : {}) };
  const rows = await prisma.student.findMany({ where, select: { id: true } });
  assertBilling(overrideScopeViolation(overrideIds, new Set(rows.map((r) => r.id))));
}

async function existingSlots(db: Tx, bulk: BulkContext, studentIds: readonly string[]): Promise<Set<string>> {
  const rows = await db.invoice.findMany({
    where: { schoolId: bulk.schoolId, studentId: { in: [...studentIds] }, type: "SPP", periodYear: bulk.input.periodYear, periodMonth: bulk.input.periodMonth },
    select: { studentId: true },
  });
  return new Set(rows.map((r) => r.studentId));
}

/** Kunci siswa chunk lalu baca ulang status & tarif (sumber kebenaran di bawah kunci). */
async function refreshChunk(tx: Tx, bulk: BulkContext, part: readonly BulkStudent[]): Promise<BulkStudent[]> {
  const ids = part.map((s) => s.id);
  await lockStudentsShared(tx, bulk.schoolId, ids);
  const fresh = await tx.student.findMany({ where: { schoolId: bulk.schoolId, id: { in: ids } }, select: { id: true, status: true, sppAmount: true } });
  const byId = new Map(fresh.map((row) => [row.id, row]));
  return part.map((s) => {
    const row = byId.get(s.id);
    return row ? { ...s, status: row.status, sppAmount: row.sppAmount } : { ...s, status: "MOVED" as const };
  });
}

async function notifyByAmount(tx: Tx, bulk: BulkContext, rows: readonly BulkRow[], ctx: ActionContext): Promise<void> {
  const amounts = [...new Set(rows.map((row) => row.amount))];
  const groups = new Map(amounts.map((amount) => [amount, rows.filter((row) => row.amount === amount).map((row) => row.studentId)] as const));
  const { periodYear, periodMonth } = bulk.input;
  for (const [amount, studentIds] of groups) {
    const event = bulkInvoiceIssuedNotification({ periodYear, periodMonth, title: bulk.title, amount, dueDate: bulk.dueDate });
    await notifyStudents(tx, studentIds, event, ctx);
  }
}

async function processChunk(tx: Tx, bulk: BulkContext, part: readonly BulkStudent[], ctx: ActionContext): Promise<ChunkOutcome> {
  const students = await refreshChunk(tx, bulk, part);
  const counter = { schoolId: bulk.schoolId, kind: "INVOICE" as const, year: bulk.year };
  await lockDocumentCounter(tx, counter, ctx.now);
  const existing = await existingSlots(tx, bulk, students.map((s) => s.id));
  const plan = planBulkInvoices({ students, existing, defaultAmount: bulk.input.amount, overrides: bulk.overrides });
  if (plan.rows.length === 0) return { created: 0, totalAmount: 0, invoiceNoFrom: null, invoiceNoTo: null, skipped: plan.skipped };
  const { numbers } = await allocateDocumentNumbers(tx, counter, plan.rows.length, ctx.now);
  const { periodYear, periodMonth } = bulk.input;
  await tx.invoice.createMany({
    data: plan.rows.map((row, i) => ({
      schoolId: bulk.schoolId, studentId: row.studentId, invoiceNo: numbers[i] ?? "", periodYear, periodMonth, title: bulk.title,
      amount: row.amount, dueDate: toDbDate(bulk.dueDate), createdAt: ctx.now,
    })),
  });
  if (bulk.input.notify) await notifyByAmount(tx, bulk, plan.rows, ctx);
  const outcome = { created: plan.rows.length, totalAmount: plan.totalAmount, invoiceNoFrom: numbers[0] ?? null, invoiceNoTo: numbers.at(-1) ?? null, skipped: plan.skipped };
  const period = `${periodYear}-${String(periodMonth).padStart(2, "0")}`;
  const after = { period, scope: bulk.input.scope.type, created: outcome.created, totalAmount: outcome.totalAmount, invoiceNoFrom: outcome.invoiceNoFrom, invoiceNoTo: outcome.invoiceNoTo, skipped: plan.skipped.length };
  await writeAudit(tx, { action: "invoice.bulk_create", entityType: "InvoicePeriod", entityId: period, schoolId: bulk.schoolId, after }, ctx);
  return outcome;
}

function combine(outcomes: readonly ChunkOutcome[], dryRun: boolean): BulkResultDto {
  const skipped = outcomes.flatMap((o) => o.skipped);
  const numbered = outcomes.filter((o) => o.invoiceNoFrom !== null);
  return {
    dryRun,
    created: outcomes.reduce((sum, o) => sum + o.created, 0),
    totalAmount: outcomes.reduce((sum, o) => sum + o.totalAmount, 0),
    invoiceNoFrom: numbered[0]?.invoiceNoFrom ?? null,
    invoiceNoTo: numbered.at(-1)?.invoiceNoTo ?? null,
    skippedCount: skipped.length,
    skipped: skipped.slice(0, MAX_BULK_SKIPPED_LISTED),
  };
}

/** dryRun: rencana dari data saat ini tanpa kunci & tanpa tulisan (nomor tidak diprediksi). */
async function dryRun(bulk: BulkContext, students: readonly BulkStudent[]): Promise<BulkResultDto> {
  const existing = await existingSlots(prisma, bulk, students.map((s) => s.id));
  const plan = planBulkInvoices({ students, existing, defaultAmount: bulk.input.amount, overrides: bulk.overrides });
  return combine([{ created: plan.rows.length, totalAmount: plan.totalAmount, invoiceNoFrom: null, invoiceNoTo: null, skipped: plan.skipped }], true);
}

/** POST /school/invoices/bulk. */
export async function bulkCreateInvoices(ctx: ActionContext, schoolId: string | undefined, input: BulkInvoiceInput): Promise<BulkResultDto> {
  const scope = billingScopeOf(ctx, schoolId);
  const school = await loadBillingSchool(prisma, scope.schoolId);
  const clock = schoolClock(school, ctx.now);
  assertBilling(validatePeriod(input.periodYear, input.periodMonth, clock.today));
  const dueDate = input.dueDate ?? defaultDueDate(input.periodYear, input.periodMonth);
  assertBilling(validateDueDate(dueDate, input.periodYear, input.periodMonth));
  const students = sortBulkStudents(await loadScopeStudents(scope.schoolId, input.scope));
  await assertScopeExists(scope.schoolId, input.scope, students);
  await assertOverridesInScope(scope.schoolId, input.scope, input.overrides.map((o) => o.studentId));
  const bulk: BulkContext = {
    schoolId: scope.schoolId, year: clock.year, input, dueDate,
    title: input.title ?? invoiceTitle(input.periodYear, input.periodMonth),
    overrides: new Map(input.overrides.map((o) => [o.studentId, o.amount])),
  };
  if (input.dryRun) return dryRun(bulk, students);
  const outcomes: ChunkOutcome[] = [];
  for (const part of chunk(students, BULK_CHUNK_SIZE)) {
    outcomes.push(await withTx((tx) => processChunk(tx, bulk, part, ctx), { timeout: BULK_TX_TIMEOUT_MS }));
  }
  return combine(outcomes, false);
}
