import { z } from "zod";
import { entityIdSchema, localDateSchema, schoolIdQuery } from "@/lib/academics/schema-common";
import { pageQuerySchema } from "@/lib/http/pagination";
import {
  INVOICE_STATUS_FILTERS,
  MAX_BULK_CLASSES,
  MAX_BULK_INVOICE_STUDENTS,
  MAX_INVOICE_AMOUNT,
  MAX_PERIOD_YEAR,
  MIN_INVOICE_AMOUNT,
  MIN_PERIOD_YEAR,
  NOTE_MAX,
  REASON_MAX,
  REASON_MIN,
  SEARCH_QUERY_MAX,
  SENDER_BANK_MAX,
  SENDER_BANK_MIN,
  SENDER_NAME_MAX,
  SENDER_NAME_MIN,
  STUDENT_INVOICE_FILTERS,
  SUBMISSION_STATUS_FILTERS,
  TITLE_MAX,
  type InvoiceStatusFilter,
} from "./constants";

/** Skema zod input SPP (validasi runtime + OpenAPI). Teks dirapikan (trim + spasi ganda jadi satu). */

const collapse = (value: string): string => value.replace(/\s+/g, " ").trim();

/**
 * Rapikan lalu cek panjang (semantik tepat pasca-normalisasi). Pipe tidak membawa batas ke JSON Schema masukan,
 * jadi minLength/maxLength dinyatakan lewat meta agar klien hasil generate memvalidasi sama.
 */
const cleanText = (min: number, max: number, label: string) =>
  z
    .string()
    .transform(collapse)
    .pipe(z.string().min(min, `${label} minimal ${min} karakter.`).max(max, `${label} maksimal ${max} karakter.`))
    .meta({ minLength: min, maxLength: max });

const amountSchema = z
  .int("Nominal harus bilangan bulat rupiah.")
  .min(MIN_INVOICE_AMOUNT, `Nominal minimal ${MIN_INVOICE_AMOUNT}.`)
  .max(MAX_INVOICE_AMOUNT, `Nominal maksimal ${MAX_INVOICE_AMOUNT}.`)
  .meta({ description: `Rupiah bulat ${MIN_INVOICE_AMOUNT}..${MAX_INVOICE_AMOUNT}.`, example: 150000 });

const paymentAmountSchema = z
  .int("Nominal harus bilangan bulat rupiah.")
  .min(1, "Nominal minimal 1.")
  .max(MAX_INVOICE_AMOUNT, `Nominal maksimal ${MAX_INVOICE_AMOUNT}.`)
  .meta({ example: 150000 });

const periodYearSchema = z.int("Tahun periode harus bilangan bulat.").min(MIN_PERIOD_YEAR).max(MAX_PERIOD_YEAR).meta({ example: 2026 });
const periodMonthSchema = z.int("Bulan periode harus bilangan bulat.").min(1, "Bulan 1-12.").max(12, "Bulan 1-12.").meta({ example: 9 });

const titleSchema = cleanText(1, TITLE_MAX, "Judul").meta({ description: "Default: \"SPP <Bulan> <Tahun>\"." });
/** Catatan opsional; string kosong = tanpa catatan. */
const optionalNote = z
  .string()
  .transform(collapse)
  .pipe(z.string().max(NOTE_MAX, `Catatan maksimal ${NOTE_MAX} karakter.`))
  .transform((value) => (value === "" ? undefined : value))
  .meta({ maxLength: NOTE_MAX })
  .optional();
const reasonSchema = cleanText(REASON_MIN, REASON_MAX, "Alasan");
const dueDateSchema = localDateSchema.meta({ description: "Jatuh tempo (tanggal lokal). Default tanggal 10 bulan periode; rentang awal (periode-1 bulan) .. akhir (periode+3 bulan)." });

// ----------------------------------------------------------------------------- tagihan

export const createInvoiceBody = z
  .strictObject({
    studentId: entityIdSchema,
    periodYear: periodYearSchema,
    periodMonth: periodMonthSchema,
    amount: amountSchema,
    dueDate: dueDateSchema.optional(),
    title: titleSchema.optional(),
    note: optionalNote,
    notify: z.boolean().default(true).meta({ description: "Kirim notifikasi INVOICE_ISSUED ke siswa (default true)." }),
  })
  .meta({ id: "CreateInvoiceInput" });
export type CreateInvoiceInput = z.output<typeof createInvoiceBody>;

const uniqueIds = (ids: readonly string[]): boolean => new Set(ids).size === ids.length;

const bulkScopeSchema = z
  .discriminatedUnion("type", [
    z.strictObject({ type: z.literal("SCHOOL") }),
    z.strictObject({
      type: z.literal("CLASSES"),
      classIds: z.array(entityIdSchema).min(1).max(MAX_BULK_CLASSES).refine(uniqueIds, "classIds tidak boleh ganda."),
    }),
    z.strictObject({
      type: z.literal("STUDENTS"),
      studentIds: z.array(entityIdSchema).min(1).max(MAX_BULK_INVOICE_STUDENTS).refine(uniqueIds, "studentIds tidak boleh ganda."),
    }),
  ])
  .meta({ id: "BulkInvoiceScope", description: "SCHOOL = semua siswa aktif; CLASSES = kelas saat ini; STUDENTS = daftar siswa." });
export type BulkScope = z.output<typeof bulkScopeSchema>;

const overrideSchema = z.strictObject({
  studentId: entityIdSchema,
  amount: z.union([z.literal(0), amountSchema]).meta({ description: "0 = bebas SPP (dilewati EXEMPT)." }),
});

export const bulkInvoiceBody = z
  .strictObject({
    periodYear: periodYearSchema,
    periodMonth: periodMonthSchema,
    amount: amountSchema.meta({ description: "Tarif default bila siswa tanpa sppAmount & tanpa override." }),
    dueDate: dueDateSchema.optional(),
    title: titleSchema.optional(),
    scope: bulkScopeSchema,
    overrides: z
      .array(overrideSchema)
      .max(MAX_BULK_INVOICE_STUDENTS)
      .refine((items) => uniqueIds(items.map((o) => o.studentId)), "studentId override tidak boleh ganda.")
      .default([]),
    dryRun: z.boolean().default(false).meta({ description: "true = hanya rencana, tanpa menulis." }),
    notify: z.boolean().default(true),
  })
  .meta({ id: "BulkInvoiceInput" });
export type BulkInvoiceInput = z.output<typeof bulkInvoiceBody>;

export const updateInvoiceBody = z
  .strictObject({
    amount: amountSchema.optional().meta({ description: "Hanya saat UNPAID tanpa bukti menunggu." }),
    dueDate: dueDateSchema.optional(),
    title: titleSchema.optional(),
    note: z
      .string()
      .transform(collapse)
      .pipe(z.string().max(NOTE_MAX, `Catatan maksimal ${NOTE_MAX} karakter.`))
      .transform((value) => (value === "" ? null : value))
      .meta({ maxLength: NOTE_MAX })
      .nullable()
      .optional()
      .meta({ description: "null/\"\" menghapus catatan." }),
  })
  .refine((value) => Object.values(value).some((v) => v !== undefined), "Minimal satu field harus diubah.")
  .meta({ id: "UpdateInvoiceInput" });
export type UpdateInvoiceInput = z.output<typeof updateInvoiceBody>;

export const reasonBody = z.strictObject({ reason: reasonSchema }).meta({ id: "BillingReasonInput" });
export type ReasonInput = z.output<typeof reasonBody>;

// ----------------------------------------------------------------------------- pembayaran

export const cashPaymentBody = z
  .strictObject({
    amount: paymentAmountSchema.meta({ description: "<= sisa dan >= min(sisa, 10.000)." }),
    paidDate: localDateSchema.meta({ description: "Tanggal uang diterima (lokal), hari ini - 31 .. hari ini." }),
    note: optionalNote,
    expectedPaidAmount: z
      .int("expectedPaidAmount harus bilangan bulat rupiah.")
      .min(0, "expectedPaidAmount minimal 0.")
      .max(MAX_INVOICE_AMOUNT, `expectedPaidAmount maksimal ${MAX_INVOICE_AMOUNT}.`)
      .meta({
        description: "paidAmount tagihan yang sedang ditampilkan ke admin (token konkurensi). Berbeda dengan paidAmount terkini -> 409 STATE_CONFLICT {paidAmount}; permintaan yang diulang (klik ganda/timeout) tidak tercatat dua kali.",
        example: 0,
      }),
  })
  .meta({ id: "CashPaymentInput" });
export type CashPaymentInput = z.output<typeof cashPaymentBody>;

export const approveSubmissionBody = z
  .strictObject({
    approvedAmount: paymentAmountSchema.optional().meta({ description: "Default = nominal bukti; 1..min(nominal bukti, sisa)." }),
    note: optionalNote.meta({ description: "Wajib bila approvedAmount < nominal bukti." }),
  })
  .meta({ id: "ApproveSubmissionInput" });
export type ApproveSubmissionInput = z.output<typeof approveSubmissionBody>;

/** Multipart siswa. Angka dikirim sebagai teks digit (tanpa titik/koma). */
export const submitProofBody = z
  .strictObject({
    amount: z
      .string()
      .trim()
      .regex(/^\d{1,9}$/, "Nominal harus bilangan bulat rupiah tanpa pemisah.")
      .transform(Number)
      .pipe(paymentAmountSchema)
      .meta({ description: "Nominal transfer (<= sisa, >= min(sisa, 10.000)).", example: "150000" }),
    transferDate: localDateSchema.meta({ description: "Tanggal transfer (lokal), hari ini - 90 .. hari ini." }),
    senderName: cleanText(SENDER_NAME_MIN, SENDER_NAME_MAX, "Nama pengirim"),
    senderBank: cleanText(SENDER_BANK_MIN, SENDER_BANK_MAX, "Bank pengirim"),
    note: optionalNote,
    file: z.file().min(1, "Foto bukti transfer wajib diisi.").meta({ description: "Foto bukti transfer JPEG/PNG/WebP (maks 8 MiB). Di-encode ulang tanpa EXIF." }),
  })
  .meta({ id: "SubmitPaymentProofInput" });
export type SubmitProofInput = z.output<typeof submitProofBody>;

// ----------------------------------------------------------------------------- query & params

export const billingIdParams = z.object({ id: entityIdSchema.meta({ description: "Id entitas." }) });

const searchSchema = z.string().trim().min(1).max(SEARCH_QUERY_MAX, `q maksimal ${SEARCH_QUERY_MAX} karakter.`);

const statusListSchema = z
  .string()
  .transform((raw, ctx) => {
    const tokens = [...new Set(raw.split(",").map((t) => t.trim().toUpperCase()).filter((t) => t.length > 0))];
    const known = new Set<string>(INVOICE_STATUS_FILTERS);
    if (tokens.length === 0 || !tokens.every((t) => known.has(t))) {
      ctx.addIssue({ code: "custom", message: `status harus daftar dipisah koma dari: ${INVOICE_STATUS_FILTERS.join(", ")}.` });
      return z.NEVER;
    }
    return tokens as InvoiceStatusFilter[];
  })
  .meta({ description: `Daftar dipisah koma: ${INVOICE_STATUS_FILTERS.join(", ")} (OVERDUE & PENDING_VERIFICATION turunan).`, example: "UNPAID,OVERDUE" });

const coercedInt = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

export const listInvoicesQuery = schoolIdQuery.extend({
  ...pageQuerySchema.shape,
  periodYear: coercedInt(MIN_PERIOD_YEAR, MAX_PERIOD_YEAR).optional(),
  periodMonth: coercedInt(1, 12).optional(),
  status: statusListSchema.optional(),
  classId: entityIdSchema.optional().meta({ description: "Kelas siswa saat ini." }),
  studentId: entityIdSchema.optional(),
  q: searchSchema.optional().meta({ description: "Nama siswa memuat / awalan NIS / awalan nomor tagihan." }),
});
export type ListInvoicesQuery = z.output<typeof listInvoicesQuery>;

export const listSubmissionsQuery = schoolIdQuery.extend({
  ...pageQuerySchema.shape,
  status: z.enum(SUBMISSION_STATUS_FILTERS).default("PENDING").meta({ description: "Default PENDING (terlama dulu); lainnya terbaru dulu." }),
  classId: entityIdSchema.optional(),
  q: searchSchema.optional().meta({ description: "Nama siswa memuat / awalan NIS / awalan nomor tagihan." }),
});
export type ListSubmissionsQuery = z.output<typeof listSubmissionsQuery>;

export const studentInvoicesQuery = pageQuerySchema.extend({
  filter: z.enum(STUDENT_INVOICE_FILTERS).default("OUTSTANDING").meta({ description: "OUTSTANDING (default), PAID, atau ALL. Tagihan dibatalkan tidak ditampilkan." }),
});
export type StudentInvoicesQuery = z.output<typeof studentInvoicesQuery>;

export { schoolIdQuery };
