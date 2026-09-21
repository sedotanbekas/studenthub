import { z } from "zod";
import { defineContract, type AnyContract } from "@/lib/http/contract";
import { BULK_CHUNK_SIZE, MAX_BULK_INVOICE_STUDENTS, MAX_CASH_BACKDATE_DAYS, MIN_PAYMENT_AMOUNT } from "./constants";
import {
  bulkResultSchema,
  invoiceDetailSchema,
  invoiceSchema,
  paymentResultSchema,
  receiptSchema,
} from "./response-schemas";
import {
  billingIdParams,
  bulkInvoiceBody,
  cashPaymentBody,
  createInvoiceBody,
  listInvoicesQuery,
  reasonBody,
  schoolIdQuery,
  updateInvoiceBody,
} from "./schemas";

/** Kontrak admin: tagihan SPP, pembayaran tunai, pembatalan pembayaran, kuitansi. */
const TAG = "SPP — Tagihan";
const SCOPE_NOTE = "SUPER_ADMIN wajib mengirim ?schoolId=. Id milik sekolah lain -> 404.";
const AMOUNT_RULE = `Nominal <= sisa dan >= min(sisa, ${MIN_PAYMENT_AMOUNT}); cicilan boleh.`;
const PERIOD_ERRORS = ["PERIOD_OUT_OF_RANGE", "DUE_DATE_OUT_OF_RANGE"] as const;

export const listInvoicesContract = defineContract({
  id: "listSchoolInvoices",
  method: "GET",
  path: "/api/v1/school/invoices",
  tag: TAG,
  summary: "Daftar tagihan SPP",
  description: `Urut periode terbaru lalu nomor tagihan. status = daftar dipisah koma (UNPAID, PARTIAL, PAID, VOID, OVERDUE = belum lunas & lewat jatuh tempo, PENDING_VERIFICATION = ada bukti menunggu); beberapa status = gabungan (OR). displayStatus: DIBATALKAN > LUNAS > MENUNGGU_VERIFIKASI > JATUH_TEMPO > SEBAGIAN > BELUM_BAYAR. ${SCOPE_NOTE}`,
  action: "billing.read",
  query: listInvoicesQuery,
  response: z.array(invoiceSchema),
  pagination: "page",
  errors: ["SCHOOL_NOT_FOUND"],
});

export const createInvoiceContract = defineContract({
  id: "createSchoolInvoice",
  method: "POST",
  path: "/api/v1/school/invoices",
  tag: TAG,
  summary: "Buat satu tagihan SPP",
  description: `Siswa ACTIVE; INACTIVE/GRADUATED hanya untuk tunggakan (periode <= bulan ini); DRAFT/MOVED -> 422 STUDENT_NOT_BILLABLE. Periode -24..+12 bulan. Slot (siswa, SPP, periode) sudah ada -> 409 INVOICE_EXISTS (details.hint = RESTORE bila tagihan lama dibatalkan). Nomor INV-YYYY-NNNNNN (tahun lokal saat terbit). Siswa menerima INVOICE_ISSUED kecuali notify=false. ${SCOPE_NOTE}`,
  action: "billing.write",
  query: schoolIdQuery,
  body: createInvoiceBody,
  response: invoiceSchema,
  successStatus: 201,
  errors: [...PERIOD_ERRORS, "STUDENT_NOT_BILLABLE", "INVOICE_EXISTS", "SCHOOL_NOT_FOUND", "CONFLICT_RETRY"],
});

export const bulkInvoicesContract = defineContract({
  id: "bulkCreateSchoolInvoices",
  method: "POST",
  path: "/api/v1/school/invoices/bulk",
  tag: TAG,
  summary: "Tagihan SPP massal satu periode (dry run tersedia)",
  description: `Hanya siswa ACTIVE (cakupan STUDENTS: siswa lain dilaporkan NOT_ACTIVE). Nominal = override ?? sppAmount siswa ?? amount; 0 = bebas (EXEMPT). Slot yang sudah ada termasuk yang dibatalkan dilewati (ALREADY_BILLED) -> menjalankan ulang aman. Diproses per ${BULK_CHUNK_SIZE} siswa per transaksi, maks ${MAX_BULK_INVOICE_STUDENTS} siswa (422 BULK_TOO_LARGE). dryRun=true hanya menghitung rencana. Kelas/siswa sekolah lain -> 404. ${SCOPE_NOTE}`,
  action: "billing.write",
  query: schoolIdQuery,
  body: bulkInvoiceBody,
  response: bulkResultSchema,
  errors: [...PERIOD_ERRORS, "BULK_TOO_LARGE", "BULK_OVERRIDE_OUT_OF_SCOPE", "CLASS_NOT_FOUND", "SCHOOL_NOT_FOUND", "CONFLICT_RETRY"],
});

export const getInvoiceContract = defineContract({
  id: "getSchoolInvoice",
  method: "GET",
  path: "/api/v1/school/invoices/{id}",
  tag: TAG,
  summary: "Detail tagihan + pembayaran + riwayat bukti transfer",
  description: SCOPE_NOTE,
  action: "billing.read",
  params: billingIdParams,
  query: schoolIdQuery,
  response: invoiceDetailSchema,
  errors: ["SCHOOL_NOT_FOUND"],
});

export const updateInvoiceContract = defineContract({
  id: "updateSchoolInvoice",
  method: "PATCH",
  path: "/api/v1/school/invoices/{id}",
  tag: TAG,
  summary: "Ubah tagihan",
  description: `Dibatalkan -> 409 INVOICE_VOID; Lunas -> hanya note (409 INVOICE_ALREADY_PAID); amount hanya saat UNPAID (409 INVOICE_HAS_PAYMENTS) tanpa bukti menunggu (409 SUBMISSION_PENDING); dueDate saat UNPAID/PARTIAL. Periode tidak dapat diubah. ${SCOPE_NOTE}`,
  action: "billing.write",
  params: billingIdParams,
  query: schoolIdQuery,
  body: updateInvoiceBody,
  response: invoiceSchema,
  errors: ["INVOICE_VOID", "INVOICE_ALREADY_PAID", "INVOICE_HAS_PAYMENTS", "SUBMISSION_PENDING", "DUE_DATE_OUT_OF_RANGE", "STATE_CONFLICT", "SCHOOL_NOT_FOUND"],
});

export const voidInvoiceContract = defineContract({
  id: "voidSchoolInvoice",
  method: "POST",
  path: "/api/v1/school/invoices/{id}/void",
  tag: TAG,
  summary: "Batalkan tagihan (alasan wajib)",
  description: `Hanya UNPAID tanpa pembayaran & tanpa bukti menunggu. Slot periode tetap terpakai (pulihkan untuk menagih lagi). Siswa menerima INVOICE_VOIDED. ${SCOPE_NOTE}`,
  action: "billing.write",
  params: billingIdParams,
  query: schoolIdQuery,
  body: reasonBody,
  response: invoiceSchema,
  errors: ["INVOICE_VOID", "INVOICE_HAS_PAYMENTS", "SUBMISSION_PENDING", "SCHOOL_NOT_FOUND"],
});

export const restoreInvoiceContract = defineContract({
  id: "restoreSchoolInvoice",
  method: "POST",
  path: "/api/v1/school/invoices/{id}/restore",
  tag: TAG,
  summary: "Pulihkan tagihan yang dibatalkan (VOID -> UNPAID)",
  description: `Tanpa body. Hanya tagihan VOID (409 INVOICE_NOT_VOID); siswa PINDAH -> 422 STUDENT_NOT_BILLABLE. ${SCOPE_NOTE}`,
  action: "billing.write",
  params: billingIdParams,
  query: schoolIdQuery,
  response: invoiceSchema,
  errors: ["INVOICE_NOT_VOID", "STUDENT_NOT_BILLABLE", "SCHOOL_NOT_FOUND"],
});

export const cashPaymentContract = defineContract({
  id: "recordSchoolCashPayment",
  method: "POST",
  path: "/api/v1/school/invoices/{id}/payments",
  tag: TAG,
  summary: "Catat pembayaran tunai",
  description: `${AMOUNT_RULE} paidDate hari ini - ${MAX_CASH_BACKDATE_DAYS} .. hari ini. Ditolak bila tagihan lunas/dibatalkan (409 INVOICE_NOT_PAYABLE) atau ada bukti transfer menunggu (409 SUBMISSION_PENDING). Membuat kuitansi KWT-YYYY-NNNNNN; siswa menerima PAYMENT_APPROVED. ${SCOPE_NOTE}`,
  action: "billing.verify",
  params: billingIdParams,
  query: schoolIdQuery,
  body: cashPaymentBody,
  response: paymentResultSchema,
  successStatus: 201,
  errors: ["INVOICE_NOT_PAYABLE", "SUBMISSION_PENDING", "PAID_DATE_OUT_OF_RANGE", "AMOUNT_EXCEEDS_REMAINING", "AMOUNT_TOO_SMALL", "PARTIAL_NOT_ALLOWED", "STATE_CONFLICT", "SCHOOL_NOT_FOUND", "CONFLICT_RETRY"],
});

export const voidPaymentContract = defineContract({
  id: "voidSchoolPayment",
  method: "POST",
  path: "/api/v1/school/payments/{id}/void",
  tag: TAG,
  summary: "Batalkan pembayaran (alasan wajib)",
  description: `Nomor kuitansi dipertahankan (kuitansi ditandai dibatalkan); status tagihan dihitung ulang. Bukti transfer terkait tetap APPROVED sebagai riwayat. Siswa menerima PAYMENT_VOIDED. ${SCOPE_NOTE}`,
  action: "billing.verify",
  params: billingIdParams,
  query: schoolIdQuery,
  body: reasonBody,
  response: paymentResultSchema,
  errors: ["PAYMENT_ALREADY_VOIDED", "STATE_CONFLICT", "SCHOOL_NOT_FOUND"],
});

export const schoolReceiptContract = defineContract({
  id: "getSchoolPaymentReceipt",
  method: "GET",
  path: "/api/v1/school/payments/{id}/receipt",
  tag: TAG,
  summary: "Data kuitansi pembayaran",
  description: SCOPE_NOTE,
  action: "billing.read",
  params: billingIdParams,
  query: schoolIdQuery,
  response: receiptSchema,
  errors: ["SCHOOL_NOT_FOUND"],
});

export const billingInvoiceContracts: readonly AnyContract[] = [
  listInvoicesContract,
  createInvoiceContract,
  bulkInvoicesContract,
  getInvoiceContract,
  updateInvoiceContract,
  voidInvoiceContract,
  restoreInvoiceContract,
  cashPaymentContract,
  voidPaymentContract,
  schoolReceiptContract,
];
