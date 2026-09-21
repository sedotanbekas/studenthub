import type { InvoiceStatus, StudentStatus } from "@prisma/client";
import { MAX_INVOICE_AMOUNT, MIN_INVOICE_AMOUNT, type BulkSkipReason } from "./constants";
import { violation, type BillingViolation } from "./errors";

/**
 * Rencana tagihan massal (murni). Nominal = override ?? sppAmount siswa ?? nominal default permintaan;
 * 0 = bebas SPP (EXEMPT). Slot yang sudah ada = ALREADY_BILLED; slot VOID = VOIDED (+ hint RESTORE: slot tetap
 * terpakai, tagihan harus dipulihkan, bukan dibuat ulang). Urutan: kelas, nama, id.
 */
export interface BulkStudent {
  readonly id: string;
  readonly name: string;
  readonly className: string | null;
  readonly sppAmount: number | null;
  readonly status: StudentStatus;
}

export interface BulkPlanInput {
  readonly students: readonly BulkStudent[];
  /** Slot tagihan periode ini per studentId (VOID termasuk). */
  readonly existing: ReadonlyMap<string, ExistingSlot>;
  readonly defaultAmount: number;
  readonly overrides: ReadonlyMap<string, number>;
}

export interface ExistingSlot {
  readonly id: string;
  readonly status: InvoiceStatus;
}

export interface BulkRow {
  readonly studentId: string;
  readonly amount: number;
}

export interface BulkSkip {
  readonly studentId: string;
  readonly reason: BulkSkipReason;
  /** Tagihan yang menempati slot (ALREADY_BILLED / VOIDED). */
  readonly invoiceId?: string;
  /** VOIDED: pulihkan lewat POST /school/invoices/{invoiceId}/restore. */
  readonly hint?: "RESTORE";
}

export interface BulkPlan {
  readonly rows: readonly BulkRow[];
  readonly skipped: readonly BulkSkip[];
  readonly totalAmount: number;
}

const collator = new Intl.Collator("id", { sensitivity: "base", numeric: true });

function compareStudents(a: BulkStudent, b: BulkStudent): number {
  if (a.className !== b.className) {
    if (a.className === null) return 1;
    if (b.className === null) return -1;
    const byClass = collator.compare(a.className, b.className);
    if (byClass !== 0) return byClass;
  }
  const byName = collator.compare(a.name, b.name);
  if (byName !== 0) return byName;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Salinan terurut (kelas kosong di akhir); input tidak dimutasi. */
export const sortBulkStudents = (students: readonly BulkStudent[]): BulkStudent[] => [...students].sort(compareStudents);

function skipOf(student: BulkStudent, amount: number, existing: ReadonlyMap<string, ExistingSlot>): BulkSkip | null {
  const skip = (reason: BulkSkipReason): BulkSkip => ({ studentId: student.id, reason });
  if (student.status !== "ACTIVE") return skip("NOT_ACTIVE");
  const slot = existing.get(student.id);
  if (slot) {
    return slot.status === "VOID"
      ? { studentId: student.id, reason: "VOIDED", invoiceId: slot.id, hint: "RESTORE" }
      : { studentId: student.id, reason: "ALREADY_BILLED", invoiceId: slot.id };
  }
  if (amount === 0) return skip("EXEMPT");
  if (!Number.isSafeInteger(amount) || amount < MIN_INVOICE_AMOUNT || amount > MAX_INVOICE_AMOUNT) return skip("AMOUNT_INVALID");
  return null;
}

export function planBulkInvoices(input: BulkPlanInput): BulkPlan {
  const rows: BulkRow[] = [];
  const skipped: BulkSkip[] = [];
  for (const student of sortBulkStudents(input.students)) {
    const amount = input.overrides.get(student.id) ?? student.sppAmount ?? input.defaultAmount;
    const skip = skipOf(student, amount, input.existing);
    if (skip) skipped.push(skip);
    else rows.push({ studentId: student.id, amount });
  }
  return { rows, skipped, totalAmount: rows.reduce((sum, row) => sum + row.amount, 0) };
}

/** Override hanya untuk siswa dalam cakupan (kelas/daftar siswa/sekolah) permintaan. */
export function overrideScopeViolation(overrideIds: readonly string[], inScope: ReadonlySet<string>): BillingViolation | null {
  const outside = overrideIds.filter((id) => !inScope.has(id));
  if (outside.length === 0) return null;
  return violation("BULK_OVERRIDE_OUT_OF_SCOPE", "Sebagian nominal khusus ditujukan ke siswa di luar cakupan penagihan.", { studentIds: outside });
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new RangeError("Ukuran chunk harus >= 1");
  return Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
}
