import type { Prisma } from "@prisma/client";
import type { ActionContext } from "@/lib/auth/principal";
import { prisma } from "@/lib/db";
import { fromDbDate } from "@/lib/time/zone";
import { billingScopeOf, loadBillingSchool } from "./context";
import { STUDENT_REF_SELECT, toStudentRef } from "./dto";
import { paymentNotFound } from "./locks";
import type { ReceiptDto } from "./response-schemas";
import { selfOf } from "./student-queries";

/** Data kuitansi (KWT-YYYY-NNNNNN). Kuitansi pembayaran yang dibatalkan tetap tampil dengan voided = true. */
const RECEIPT_SELECT = {
  id: true, receiptNo: true, amount: true, method: true, paidDate: true, note: true, createdAt: true, voidedAt: true, voidReason: true,
  recordedBy: { select: { name: true } },
  school: { select: { name: true, npsn: true, address: true } },
  invoice: {
    select: { id: true, invoiceNo: true, title: true, periodYear: true, periodMonth: true, amount: true, student: { select: STUDENT_REF_SELECT } },
  },
} as const satisfies Prisma.PaymentSelect;

type ReceiptRow = Prisma.PaymentGetPayload<{ select: typeof RECEIPT_SELECT }>;

function toReceipt(row: ReceiptRow): ReceiptDto {
  const { student, ...invoice } = row.invoice;
  return {
    paymentId: row.id,
    receiptNo: row.receiptNo,
    school: row.school,
    student: toStudentRef(student),
    invoice,
    amount: row.amount,
    method: row.method,
    paidDate: fromDbDate(row.paidDate),
    note: row.note,
    recordedBy: row.recordedBy.name,
    issuedAt: row.createdAt.toISOString(),
    voided: row.voidedAt !== null,
    voidedAt: row.voidedAt?.toISOString() ?? null,
    voidReason: row.voidReason,
  };
}

async function loadReceipt(where: Prisma.PaymentWhereInput): Promise<ReceiptDto> {
  const row = await prisma.payment.findFirst({ where, select: RECEIPT_SELECT });
  if (!row) throw paymentNotFound();
  return toReceipt(row);
}

/** GET /school/payments/{id}/receipt. */
export async function getSchoolReceipt(ctx: ActionContext, schoolId: string | undefined, id: string): Promise<ReceiptDto> {
  const scope = billingScopeOf(ctx, schoolId);
  await loadBillingSchool(prisma, scope.schoolId);
  return loadReceipt({ id, schoolId: scope.schoolId });
}

/** GET /student/payments/{id}/receipt: hanya pembayaran atas tagihan milik sendiri (lainnya 404). */
export async function getOwnReceipt(ctx: ActionContext, id: string): Promise<ReceiptDto> {
  const self = selfOf(ctx);
  return loadReceipt({ id, schoolId: self.schoolId, invoice: { studentId: self.studentId } });
}
