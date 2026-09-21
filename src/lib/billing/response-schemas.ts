import { z } from "zod";
import { dateOutSchema } from "@/lib/academics/schema-common";
import { pageMetaSchema } from "@/lib/openapi/schemas";
import { BULK_SKIP_REASONS, DISPLAY_STATUSES, INVOICE_STATUSES, PAYMENT_METHODS, SUBMISSION_STATUSES } from "./constants";

/** Skema respons SPP (OpenAPI + validasi respons di mode test). Uang = rupiah bulat. */

const dateTime = z.string().meta({ format: "date-time" });
const money = z.int();
const invoiceStatus = z.enum(INVOICE_STATUSES);
const displayStatus = z.enum(DISPLAY_STATUSES).meta({ description: "Status tampilan (label di /meta/enums InvoiceDisplayStatus)." });
const method = z.enum(PAYMENT_METHODS);

export const billingStudentRefSchema = z
  .object({ id: z.string(), name: z.string(), nis: z.string(), className: z.string().nullable() })
  .meta({ id: "BillingStudentRef" });

export const billingUserRefSchema = z.object({ id: z.string(), name: z.string() }).meta({ id: "BillingUserRef" });

const invoiceCore = {
  id: z.string(),
  invoiceNo: z.string().meta({ example: "INV-2026-000123" }),
  title: z.string(),
  periodYear: z.int(),
  periodMonth: z.int(),
  amount: money,
  paidAmount: money,
  remaining: money,
  dueDate: dateOutSchema,
  status: invoiceStatus,
  displayStatus,
  isOverdue: z.boolean(),
};

export const invoiceSchema = z
  .object({
    ...invoiceCore,
    student: billingStudentRefSchema,
    pendingSubmissionId: z.string().nullable(),
    paidAt: dateTime.nullable(),
    note: z.string().nullable(),
    voidedAt: dateTime.nullable(),
    voidReason: z.string().nullable(),
    createdAt: dateTime,
  })
  .meta({ id: "Invoice" });
export type InvoiceDto = z.input<typeof invoiceSchema>;

export const paymentSchema = z
  .object({
    id: z.string(),
    invoiceId: z.string(),
    receiptNo: z.string().meta({ example: "KWT-2026-000045" }),
    amount: money,
    method,
    paidDate: dateOutSchema,
    note: z.string().nullable(),
    submissionId: z.string().nullable(),
    recordedBy: billingUserRefSchema,
    voided: z.boolean(),
    voidedAt: dateTime.nullable(),
    voidReason: z.string().nullable(),
    createdAt: dateTime,
  })
  .meta({ id: "Payment" });
export type PaymentDto = z.input<typeof paymentSchema>;

export const submissionSummarySchema = z
  .object({
    id: z.string(),
    invoiceId: z.string(),
    status: z.enum(SUBMISSION_STATUSES),
    amount: money,
    transferDate: dateOutSchema,
    senderName: z.string().nullable(),
    senderBank: z.string().nullable(),
    note: z.string().nullable(),
    reviewNote: z.string().nullable().meta({ description: "Catatan persetujuan / alasan penolakan." }),
    reviewedAt: dateTime.nullable(),
    createdAt: dateTime,
    proofFileId: z.string().meta({ description: "Unduh lewat GET /api/v1/files/{id}." }),
  })
  .meta({ id: "PaymentSubmissionSummary" });
export type SubmissionSummaryDto = z.input<typeof submissionSummarySchema>;

export const invoiceDetailSchema = invoiceSchema
  .extend({
    voidedBy: billingUserRefSchema.nullable(),
    payments: z.array(paymentSchema),
    submissions: z.array(submissionSummarySchema),
  })
  .meta({ id: "InvoiceDetail" });
export type InvoiceDetailDto = z.input<typeof invoiceDetailSchema>;

export const paymentResultSchema = z.object({ payment: paymentSchema, invoice: invoiceSchema }).meta({ id: "PaymentResult" });
export type PaymentResultDto = z.input<typeof paymentResultSchema>;

export const bulkResultSchema = z
  .object({
    dryRun: z.boolean(),
    created: z.int().meta({ description: "Jumlah tagihan dibuat (dryRun: yang akan dibuat)." }),
    totalAmount: money,
    invoiceNoFrom: z.string().nullable().meta({ description: "Nomor pertama (null bila dryRun/tidak ada)." }),
    invoiceNoTo: z.string().nullable(),
    skippedCount: z.int(),
    skipped: z
      .array(z.object({ studentId: z.string(), reason: z.enum(BULK_SKIP_REASONS) }))
      .meta({ description: "Maks 500 baris: ALREADY_BILLED, EXEMPT (tarif 0), NOT_ACTIVE (cakupan STUDENTS), AMOUNT_INVALID (tarif siswa < 1.000)." }),
  })
  .meta({ id: "BulkInvoiceResult" });
export type BulkResultDto = z.input<typeof bulkResultSchema>;

export const receiptSchema = z
  .object({
    paymentId: z.string(),
    receiptNo: z.string(),
    school: z.object({ name: z.string(), npsn: z.string().nullable(), address: z.string().nullable() }),
    student: billingStudentRefSchema,
    invoice: z.object({ id: z.string(), invoiceNo: z.string(), title: z.string(), periodYear: z.int(), periodMonth: z.int(), amount: money }),
    amount: money,
    method,
    paidDate: dateOutSchema,
    note: z.string().nullable(),
    recordedBy: z.string().meta({ description: "Nama admin pencatat/pemverifikasi." }),
    issuedAt: dateTime,
    voided: z.boolean().meta({ description: "true = kuitansi dibatalkan (cap DIBATALKAN); nomor tetap." }),
    voidedAt: dateTime.nullable(),
    voidReason: z.string().nullable(),
  })
  .meta({ id: "PaymentReceipt" });
export type ReceiptDto = z.input<typeof receiptSchema>;

export const adminSubmissionSchema = submissionSummarySchema
  .extend({
    invoice: z.object({
      id: z.string(), invoiceNo: z.string(), title: z.string(), amount: money, paidAmount: money, remaining: money, status: invoiceStatus,
    }),
    student: billingStudentRefSchema,
    possibleDuplicateOf: z
      .array(z.string())
      .meta({ description: "Id pengajuan lain di sekolah ini yang fotonya mirip (dHash). Hanya penanda, bukan penolakan." }),
  })
  .meta({ id: "PaymentSubmission" });
export type AdminSubmissionDto = z.input<typeof adminSubmissionSchema>;

export const adminSubmissionDetailSchema = adminSubmissionSchema
  .extend({
    reviewedBy: billingUserRefSchema.nullable(),
    payment: z.object({ id: z.string(), receiptNo: z.string(), amount: money, voided: z.boolean() }).nullable(),
    history: z.array(submissionSummarySchema).meta({ description: "Pengajuan lain untuk tagihan yang sama (terbaru dulu)." }),
  })
  .meta({ id: "PaymentSubmissionDetail" });
export type AdminSubmissionDetailDto = z.input<typeof adminSubmissionDetailSchema>;

export const approveResultSchema = z
  .object({ submission: adminSubmissionSchema, payment: paymentSchema, invoice: invoiceSchema })
  .meta({ id: "PaymentApprovalResult" });
export type ApproveResultDto = z.input<typeof approveResultSchema>;

// ----------------------------------------------------------------------------- siswa

export const paymentInfoSchema = z
  .object({
    bankName: z.string().nullable(),
    bankAccountNumber: z.string().nullable(),
    bankAccountHolder: z.string().nullable(),
    bankChangedAt: dateTime.nullable(),
    bankRecentlyChanged: z.boolean().meta({ description: "true selama 14 hari sejak rekening diubah super admin." }),
    notice: z.string(),
  })
  .meta({ id: "PaymentInfo" });
export type PaymentInfoDto = z.input<typeof paymentInfoSchema>;

export const studentInvoiceSchema = z
  .object({
    ...invoiceCore,
    pendingSubmission: z.object({ id: z.string(), amount: money, createdAt: dateTime }).nullable(),
  })
  .meta({ id: "StudentInvoice" });
export type StudentInvoiceDto = z.input<typeof studentInvoiceSchema>;

export const studentPaymentSchema = z
  .object({ id: z.string(), receiptNo: z.string(), amount: money, method, paidDate: dateOutSchema, voided: z.boolean(), createdAt: dateTime })
  .meta({ id: "StudentPayment" });

export const studentInvoiceDetailSchema = studentInvoiceSchema
  .extend({
    note: z.string().nullable(),
    paidAt: dateTime.nullable(),
    voidReason: z.string().nullable(),
    payments: z.array(studentPaymentSchema),
    submissions: z.array(submissionSummarySchema),
    bankAccount: paymentInfoSchema,
  })
  .meta({ id: "StudentInvoiceDetail" });
export type StudentInvoiceDetailDto = z.input<typeof studentInvoiceDetailSchema>;

export const studentInvoicesMetaSchema = z
  .object({
    ...pageMetaSchema.shape,
    summary: z.object({
      outstandingAmount: money.meta({ description: "Total sisa tagihan Belum Bayar/Sebagian (termasuk periode mendatang)." }),
      outstandingCount: z.int(),
    }),
  })
  .meta({ id: "StudentInvoicesMeta" });
export type StudentInvoicesMeta = z.input<typeof studentInvoicesMetaSchema>;
