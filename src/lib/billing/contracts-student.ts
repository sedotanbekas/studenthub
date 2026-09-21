import { z } from "zod";
import { defineContract, type AnyContract } from "@/lib/http/contract";
import { MAX_SUBMISSIONS_PER_INVOICE_PER_DAY, MAX_TRANSFER_AGE_DAYS, MIN_PAYMENT_AMOUNT, PROOF_MAX_BODY_BYTES } from "./constants";
import {
  paymentInfoSchema,
  receiptSchema,
  studentInvoiceDetailSchema,
  studentInvoiceSchema,
  studentInvoicesMetaSchema,
  submissionSummarySchema,
} from "./response-schemas";
import { billingIdParams, studentInvoicesQuery, submitProofBody } from "./schemas";

/** Kontrak siswa: tagihan, unggah/batal bukti transfer, kuitansi, rekening SPP. Siswa Aktif atau Lulus. */
const TAG = "SPP — Siswa";
const UPLOAD_ERRORS = [
  "LENGTH_REQUIRED", "PAYLOAD_TOO_LARGE", "UNSUPPORTED_MEDIA_TYPE", "HEIC_NOT_SUPPORTED", "IMAGE_UNREADABLE", "IMAGE_TOO_LARGE", "SERVICE_UNAVAILABLE",
] as const;

export const listOwnInvoicesContract = defineContract({
  id: "listOwnInvoices",
  method: "GET",
  path: "/api/v1/student/invoices",
  tag: TAG,
  summary: "Tagihan SPP milik siswa",
  description: "filter=OUTSTANDING (default; jatuh tempo terdekat dulu), PAID, atau ALL (periode terbaru dulu). Tagihan dibatalkan tidak ditampilkan. meta.summary = total sisa tagihan.",
  action: "billing.self.read",
  query: studentInvoicesQuery,
  response: z.array(studentInvoiceSchema),
  pagination: "page",
  meta: studentInvoicesMetaSchema,
});

export const getOwnInvoiceContract = defineContract({
  id: "getOwnInvoice",
  method: "GET",
  path: "/api/v1/student/invoices/{id}",
  tag: TAG,
  summary: "Detail tagihan + pembayaran + bukti + rekening sekolah",
  description: "Tagihan siswa lain -> 404.",
  action: "billing.self.read",
  params: billingIdParams,
  response: studentInvoiceDetailSchema,
});

export const submitProofContract = defineContract({
  id: "submitOwnPaymentProof",
  method: "POST",
  path: "/api/v1/student/invoices/{id}/submissions",
  tag: TAG,
  summary: "Unggah bukti transfer (multipart)",
  description: `Tagihan Belum Bayar/Sebagian (409 INVOICE_NOT_PAYABLE), maks satu bukti menunggu per tagihan (409 SUBMISSION_PENDING), maks ${MAX_SUBMISSIONS_PER_INVOICE_PER_DAY} unggahan per tagihan per hari (429 TOO_MANY_SUBMISSIONS + Retry-After). Nominal <= sisa dan >= min(sisa, ${MIN_PAYMENT_AMOUNT}). transferDate hari ini - ${MAX_TRANSFER_AGE_DAYS} .. hari ini. Foto JPEG/PNG/WebP di-encode ulang tanpa EXIF, disimpan privat. Admin sekolah menerima PAYMENT_SUBMITTED. Tagihan siswa lain -> 404.`,
  action: "billing.self.pay",
  params: billingIdParams,
  body: submitProofBody,
  bodyType: "multipart",
  maxBodyBytes: PROOF_MAX_BODY_BYTES,
  response: submissionSummarySchema,
  successStatus: 201,
  rateLimit: { limiter: "UPLOAD", key: "user" },
  errors: [
    "INVOICE_NOT_PAYABLE", "SUBMISSION_PENDING", "TOO_MANY_SUBMISSIONS", "AMOUNT_EXCEEDS_REMAINING", "AMOUNT_TOO_SMALL", "PARTIAL_NOT_ALLOWED",
    "TRANSFER_DATE_OUT_OF_RANGE", ...UPLOAD_ERRORS, "RATE_LIMITED", "CONFLICT_RETRY",
  ],
});

export const cancelOwnSubmissionContract = defineContract({
  id: "cancelOwnPaymentSubmission",
  method: "POST",
  path: "/api/v1/student/payment-submissions/{id}/cancel",
  tag: TAG,
  summary: "Batalkan bukti transfer yang masih Menunggu",
  description: "Hanya milik sendiri berstatus PENDING (409 SUBMISSION_NOT_PENDING). Pengajuan siswa lain -> 404.",
  action: "billing.self.pay",
  params: billingIdParams,
  response: submissionSummarySchema,
  errors: ["SUBMISSION_NOT_PENDING"],
});

export const ownReceiptContract = defineContract({
  id: "getOwnPaymentReceipt",
  method: "GET",
  path: "/api/v1/student/payments/{id}/receipt",
  tag: TAG,
  summary: "Kuitansi pembayaran milik siswa",
  description: "Pembayaran atas tagihan siswa lain -> 404. Kuitansi pembayaran yang dibatalkan: voided = true.",
  action: "billing.self.read",
  params: billingIdParams,
  response: receiptSchema,
});

export const paymentInfoContract = defineContract({
  id: "getOwnPaymentInfo",
  method: "GET",
  path: "/api/v1/student/payment-info",
  tag: TAG,
  summary: "Rekening SPP sekolah",
  description: "Rekening hanya diubah super admin. bankRecentlyChanged = true selama 14 hari sejak perubahan (tampilkan peringatan).",
  action: "billing.self.read",
  response: paymentInfoSchema,
});

export const billingStudentContracts: readonly AnyContract[] = [
  listOwnInvoicesContract,
  getOwnInvoiceContract,
  submitProofContract,
  cancelOwnSubmissionContract,
  ownReceiptContract,
  paymentInfoContract,
];
