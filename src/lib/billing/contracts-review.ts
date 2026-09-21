import { z } from "zod";
import { defineContract, type AnyContract } from "@/lib/http/contract";
import { adminSubmissionDetailSchema, adminSubmissionSchema, approveResultSchema } from "./response-schemas";
import { approveSubmissionBody, billingIdParams, listSubmissionsQuery, reasonBody, schoolIdQuery } from "./schemas";

/** Kontrak admin: antrean & verifikasi bukti transfer SPP. */
const TAG = "SPP — Verifikasi Bukti Transfer";
const SCOPE_NOTE = "SUPER_ADMIN wajib mengirim ?schoolId=. Id milik sekolah lain -> 404.";
const DUPLICATE_NOTE = "possibleDuplicateOf = maks 5 pengajuan lain di sekolah ini dengan foto bukti identik (sha256) atau mirip (dHash) — penanda, bukan penolakan.";

export const listSubmissionsContract = defineContract({
  id: "listSchoolPaymentSubmissions",
  method: "GET",
  path: "/api/v1/school/payment-submissions",
  tag: TAG,
  summary: "Antrean bukti transfer",
  description: `Default status=PENDING (terlama dulu); status lain/ALL terbaru dulu. ${DUPLICATE_NOTE} Foto diunduh lewat GET /api/v1/files/{proofFileId}. ${SCOPE_NOTE}`,
  action: "billing.read",
  query: listSubmissionsQuery,
  response: z.array(adminSubmissionSchema),
  pagination: "page",
  errors: ["SCHOOL_NOT_FOUND"],
});

export const getSubmissionContract = defineContract({
  id: "getSchoolPaymentSubmission",
  method: "GET",
  path: "/api/v1/school/payment-submissions/{id}",
  tag: TAG,
  summary: "Detail bukti transfer + riwayat pengajuan tagihan",
  description: `${DUPLICATE_NOTE} ${SCOPE_NOTE}`,
  action: "billing.read",
  params: billingIdParams,
  query: schoolIdQuery,
  response: adminSubmissionDetailSchema,
  errors: ["SCHOOL_NOT_FOUND"],
});

export const approveSubmissionContract = defineContract({
  id: "approveSchoolPaymentSubmission",
  method: "POST",
  path: "/api/v1/school/payment-submissions/{id}/approve",
  tag: TAG,
  summary: "Setujui bukti transfer",
  description: `Body JSON boleh {}. Hanya PENDING (409 SUBMISSION_ALREADY_REVIEWED). approvedAmount default = nominal bukti; wajib 1..min(nominal bukti, sisa) (422 APPROVED_AMOUNT_INVALID / AMOUNT_EXCEEDS_REMAINING); sisa < nominal bukti tanpa approvedAmount -> 422 AMOUNT_EXCEEDS_REMAINING; approvedAmount < nominal bukti wajib note (422 NOTE_REQUIRED). Membuat Payment TRANSFER (paidDate = tanggal transfer) + kuitansi; tagihan menjadi SEBAGIAN/LUNAS; siswa menerima PAYMENT_APPROVED. ${SCOPE_NOTE}`,
  action: "billing.verify",
  params: billingIdParams,
  query: schoolIdQuery,
  body: approveSubmissionBody,
  response: approveResultSchema,
  errors: [
    "SUBMISSION_ALREADY_REVIEWED", "INVOICE_NOT_PAYABLE", "INVOICE_ALREADY_PAID", "AMOUNT_EXCEEDS_REMAINING", "APPROVED_AMOUNT_INVALID", "NOTE_REQUIRED",
    "STATE_CONFLICT", "SCHOOL_NOT_FOUND", "CONFLICT_RETRY",
  ],
});

export const rejectSubmissionContract = defineContract({
  id: "rejectSchoolPaymentSubmission",
  method: "POST",
  path: "/api/v1/school/payment-submissions/{id}/reject",
  tag: TAG,
  summary: "Tolak bukti transfer (alasan wajib)",
  description: `Hanya PENDING (409 SUBMISSION_ALREADY_REVIEWED). Alasan 5-255 karakter dikirim ke siswa (PAYMENT_REJECTED). ${SCOPE_NOTE}`,
  action: "billing.verify",
  params: billingIdParams,
  query: schoolIdQuery,
  body: reasonBody,
  response: adminSubmissionSchema,
  errors: ["SUBMISSION_ALREADY_REVIEWED", "SCHOOL_NOT_FOUND"],
});

export const billingReviewContracts: readonly AnyContract[] = [
  listSubmissionsContract,
  getSubmissionContract,
  approveSubmissionContract,
  rejectSubmissionContract,
];
