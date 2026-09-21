import type { ActionContext } from "@/lib/auth/principal";
import { prisma, type Tx } from "@/lib/db";
import { conflict } from "@/lib/http/errors";
import { notifySchoolAdmins } from "@/lib/notifications/notify";
import { paymentSubmittedNotification } from "@/lib/notifications/templates/billing";
import { assertDiskSpace } from "@/lib/storage/disk";
import { storageRoot } from "@/lib/storage/driver";
import { discardFile, persistProcessedFile } from "@/lib/storage/files";
import { processImage, type ProcessedImage } from "@/lib/storage/image";
import { uniqueIndexOf } from "@/lib/students/unique-error";
import { addDays, instantAtLocal, toDbDate } from "@/lib/time/zone";
import { withTx } from "@/lib/tx";
import { loadBillingSchool, schoolClock, type BillingSchool } from "./context";
import { findUploadMatches, recordProofMatches, type ProofMatch } from "./duplicate-queries";
import { failBilling, violation } from "./errors";
import { findInvoiceOwner, readInvoiceState } from "./invoice-state";
import { lockStudentAndInvoice, submissionNotFound } from "./locks";
import type { SubmissionSummaryDto } from "./response-schemas";
import type { SubmitProofInput } from "./schemas";
import { loadOwnSubmission, selfOf, type StudentSelf } from "./student-queries";
import { submissionViolation } from "./submission-rules";

/**
 * Unggah bukti transfer oleh siswa (multipart atomik) & pembatalan. Foto diproses di luar transaksi
 * (guard disk, re-encode tanpa EXIF, dHash); di transaksi: Student (bersama) -> Invoice FOR UPDATE milik
 * siswa -> aturan -> StoredFile + PaymentSubmission (pendingInvoiceId = invoiceId) -> notifikasi admin ->
 * penanda bukti identik/mirip (PaymentProofMatch, dua arah; kecocokan dicari sebelum transaksi).
 * Gagal di mana pun -> berkas di disk dibuang (tanpa yatim).
 */
const PENDING_INDEX = "PaymentSubmission_pendingInvoiceId_key";

const pendingConflict = () => failBilling(violation("SUBMISSION_PENDING", "Masih ada bukti transfer yang menunggu verifikasi untuk tagihan ini."));

/** Awal hari lokal sekolah & detik sampai hari berikutnya (kuota harian per tagihan). */
function dayWindow(school: BillingSchool, now: Date): { from: Date; retryAfterSeconds: number } {
  const { today } = schoolClock(school, now);
  const next = instantAtLocal(addDays(today, 1), 0, school.timezone);
  return { from: instantAtLocal(today, 0, school.timezone), retryAfterSeconds: Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 1000)) };
}

/** Aturan pengajuan terhadap status tagihan saat ini (pra-cek tanpa kunci, lalu diulang di bawah kunci). */
async function assessSubmission(db: Tx, school: BillingSchool, invoiceId: string, input: SubmitProofInput, now: Date): Promise<void> {
  const invoice = await readInvoiceState(db, school.id, invoiceId);
  const window = dayWindow(school, now);
  const submittedToday = await db.paymentSubmission.count({ where: { schoolId: school.id, invoiceId, createdAt: { gte: window.from } } });
  const state = { ...invoice, hasPending: invoice.pendingSubmissionId !== null, submittedToday };
  const found = submissionViolation(state, { amount: input.amount, transferDate: input.transferDate }, schoolClock(school, now).today);
  if (!found) return;
  const retry = found.code === "TOO_MANY_SUBMISSIONS" ? { "Retry-After": String(window.retryAfterSeconds) } : undefined;
  failBilling(retry ? { ...found, details: { ...found.details, retryAfterSeconds: window.retryAfterSeconds } } : found, retry);
}

interface ProofWork {
  readonly self: StudentSelf;
  readonly school: BillingSchool;
  readonly invoiceId: string;
  readonly input: SubmitProofInput;
  readonly processed: ProcessedImage;
  /** Bukti identik/mirip di sekolah ini, dihitung sebelum transaksi (baca saja, tanpa kunci). */
  readonly matches: readonly ProofMatch[];
}

async function insertSubmission(tx: Tx, work: ProofWork, written: string[], ctx: ActionContext): Promise<string> {
  const { self, school, invoiceId, input } = work;
  await lockStudentAndInvoice(tx, { id: invoiceId, schoolId: school.id, studentId: self.studentId });
  await assessSubmission(tx, school, invoiceId, input, ctx.now);
  const file = await persistProcessedFile(
    tx,
    { kind: "PAYMENT_PROOF", processed: work.processed, uploadedById: self.userId, schoolId: school.id, bucket: "private", attachedAt: ctx.now, originalName: input.file.name },
    ctx.now,
  );
  written.push(file.storageKey);
  const submission = await tx.paymentSubmission.create({
    data: {
      schoolId: school.id, invoiceId, studentId: self.studentId, amount: input.amount, transferDate: toDbDate(input.transferDate),
      senderName: input.senderName, senderBank: input.senderBank, note: input.note ?? null, proofFileId: file.id,
      pendingInvoiceId: invoiceId, createdAt: ctx.now,
    },
    select: { id: true, invoice: { select: { title: true } }, student: { select: { user: { select: { name: true } }, currentClass: { select: { name: true } } } } },
  });
  // Urutan kunci: PaymentSubmission (FK tepi penanda) sebelum Notification.
  await recordProofMatches(tx, submission.id, work.matches, ctx.now);
  const event = paymentSubmittedNotification({
    submissionId: submission.id, studentName: submission.student.user.name, className: submission.student.currentClass?.name ?? null,
    invoiceTitle: submission.invoice.title, amount: input.amount,
  });
  await notifySchoolAdmins(tx, school.id, event, ctx);
  return submission.id;
}

/** withTx yang membuang berkas setiap percobaan gagal (deadlock-retry menulis ulang berkas baru). */
async function withProofTx(work: ProofWork, ctx: ActionContext): Promise<string> {
  const written: string[] = [];
  try {
    const id = await withTx((tx) => insertSubmission(tx, work, written, ctx));
    await Promise.all(written.slice(0, -1).map(discardFile));
    return id;
  } catch (error) {
    await Promise.all(written.map(discardFile));
    if (uniqueIndexOf(error) === PENDING_INDEX) pendingConflict();
    throw error;
  }
}

/** POST /student/invoices/{id}/submissions (multipart). */
export async function submitPaymentProof(ctx: ActionContext, invoiceId: string, input: SubmitProofInput): Promise<SubmissionSummaryDto> {
  const self = selfOf(ctx);
  const school = await loadBillingSchool(prisma, self.schoolId);
  await findInvoiceOwner(prisma, school.id, invoiceId, self.studentId);
  await assessSubmission(prisma, school, invoiceId, input, ctx.now);
  await assertDiskSpace(storageRoot());
  const processed = await processImage(new Uint8Array(await input.file.arrayBuffer()), "PAYMENT_PROOF");
  const proof = { schoolId: school.id, studentId: self.studentId, sha256: processed.sha256, phash: processed.phash };
  const matches = await findUploadMatches(prisma, proof, ctx.now);
  const id = await withProofTx({ self, school, invoiceId, input, processed, matches }, ctx);
  return loadOwnSubmission(prisma, self, id);
}

/** POST /student/payment-submissions/{id}/cancel: CAS PENDING -> CANCELLED milik sendiri, slot pending dibebaskan. */
export async function cancelOwnSubmission(ctx: ActionContext, id: string): Promise<SubmissionSummaryDto> {
  const self = selfOf(ctx);
  const owned = { id, schoolId: self.schoolId, studentId: self.studentId };
  const target = await prisma.paymentSubmission.findFirst({ where: owned, select: { invoiceId: true } });
  if (!target) throw submissionNotFound();
  await withTx(async (tx) => {
    await lockStudentAndInvoice(tx, { id: target.invoiceId, schoolId: self.schoolId, studentId: self.studentId });
    const updated = await tx.paymentSubmission.updateMany({ where: { ...owned, status: "PENDING" }, data: { status: "CANCELLED", pendingInvoiceId: null } });
    if (updated.count === 1) return;
    const current = await tx.paymentSubmission.findFirst({ where: owned, select: { status: true } });
    throw conflict("SUBMISSION_NOT_PENDING", "Hanya bukti transfer berstatus Menunggu yang dapat dibatalkan.", { status: current?.status ?? null });
  });
  return loadOwnSubmission(prisma, self, id);
}
