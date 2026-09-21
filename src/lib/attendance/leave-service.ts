import { assertNoViolation } from "@/lib/academics/guards";
import { writeAudit } from "@/lib/audit";
import { requirePrincipal, type ActionContext } from "@/lib/auth/principal";
import { loadCalendarContext } from "@/lib/calendar/queries";
import { listSchoolDays } from "@/lib/calendar/rules";
import { prisma, type Tx } from "@/lib/db";
import { conflict, forbidden, notFound } from "@/lib/http/errors";
import { assertRateLimit, getLimiter } from "@/lib/http/rate-limits";
import { notifySchoolAdmins, notifyStudents } from "@/lib/notifications/notify";
import { leaveApprovedNotification, leaveRejectedNotification, leaveSubmittedNotification } from "@/lib/notifications/templates/attendance-leave";
import { assertDiskSpace } from "@/lib/storage/disk";
import { storageRoot } from "@/lib/storage/driver";
import { discardFile, persistProcessedFile } from "@/lib/storage/files";
import { processImage, type ProcessedImage } from "@/lib/storage/image";
import { studentSelf, type SchoolScope } from "@/lib/tenant/scope";
import { fromDbDate, localParts, toDbDate, type LocalDate } from "@/lib/time/zone";
import { lockKey, lockRows, withTx } from "@/lib/tx";
import { attendanceLockKey } from "@/lib/lock-keys";
import type { LeaveTypeValue } from "./leave-constants";
import { getOwnLeave, leaveScopeOf, loadLeaveSchool, loadSchoolLeaveItem, type LeaveSchool } from "./leave-queries";
import { checkLeaveDays, findOverlappingLeave, validateLeaveRange, type LeaveActor } from "./leave-rules";
import type {
  ApproveLeaveInput,
  CreateLeaveInput,
  CreateLeaveOnBehalfInput,
  LeaveDecisionDto,
  LeaveRequestDto,
  RejectLeaveInput,
  SchoolLeaveDto,
} from "./leave-schemas";
import { materializeLeave, withMaterializeRetry, type MaterializeResult } from "./materialize";

/**
 * Mutasi izin/sakit. Urutan kunci di setiap transaksi (src/lib/tx.ts): AppLock `attendance:<studentId>`
 * -> Student FOR UPDATE -> LeaveRequest FOR UPDATE -> Attendance; Notification & AuditLog terakhir.
 * Kunci selalu diambil SEBELUM membaca; transisi status memakai compare-and-set (updateMany).
 * Lampiran diproses (sharp) di luar transaksi; berkas percobaan yang gagal dibuang dari disk.
 */
interface LeaveRangeFields {
  readonly type: LeaveTypeValue;
  readonly startDate: LocalDate;
  readonly endDate: LocalDate;
}

interface LockedStudent {
  readonly id: string;
  readonly userId: string;
  readonly status: string;
  readonly currentClassId: string | null;
  readonly name: string;
  readonly className: string | null;
  /** Tanggal lokal aktivasi (Student.activatedAt) — batas bawah materialisasi. */
  readonly enrolledFrom: LocalDate | null;
}

interface PendingUpload {
  readonly processed: ProcessedImage;
  readonly uploadedById: string;
  readonly schoolId: string;
}

type AttachFn = () => Promise<string | null>;

const notFoundStudent = () => notFound("Siswa tidak ditemukan.");
const notFoundLeave = () => notFound("Pengajuan izin tidak ditemukan.");
const alreadyReviewed = (status: string) =>
  conflict("LEAVE_ALREADY_REVIEWED", "Pengajuan izin ini sudah ditinjau atau dibatalkan.", { status });

const localToday = (school: LeaveSchool, now: Date): LocalDate => localParts(now, school.timezone).ymd;

function assertRange(input: LeaveRangeFields, school: LeaveSchool, now: Date, actor: LeaveActor): void {
  assertNoViolation(validateLeaveRange({ startDate: input.startDate, endDate: input.endDate, today: localToday(school, now), actor }));
}

// ----------------------------------------------------------------------------- penjaga bersama

/** Kunci `attendance:<studentId>` lalu Student FOR UPDATE (dalam cakupan sekolah), BARU membaca siswa. */
async function lockStudentForLeave(tx: Tx, school: LeaveSchool, studentId: string): Promise<LockedStudent> {
  await lockKey(tx, attendanceLockKey(studentId));
  const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT \`id\` FROM \`Student\` WHERE \`id\` = ${studentId} AND \`schoolId\` = ${school.id} FOR UPDATE`;
  if (locked.length === 0) throw notFoundStudent();
  const row = await tx.student.findFirst({
    where: { id: studentId, schoolId: school.id },
    select: {
      id: true, userId: true, status: true, currentClassId: true, activatedAt: true,
      user: { select: { name: true } }, currentClass: { select: { name: true } },
    },
  });
  if (!row) throw notFoundStudent();
  return {
    id: row.id, userId: row.userId, status: row.status, currentClassId: row.currentClassId, name: row.user.name,
    className: row.currentClass?.name ?? null,
    enrolledFrom: row.activatedAt ? localParts(row.activatedAt, school.timezone).ymd : null,
  };
}

async function schoolDaysIn(db: Tx, school: LeaveSchool, input: LeaveRangeFields): Promise<LocalDate[]> {
  const calendar = await loadCalendarContext(db, school, { from: input.startDate, to: input.endDate });
  return listSchoolDays(input.startDate, input.endDate, calendar);
}

/**
 * Hari sekolah (>= 1), aturan lampiran SAKIT, dan tumpang tindih dengan izin PENDING/APPROVED siswa.
 * Dipanggil sebagai pra-cek di luar transaksi (hindari memproses foto untuk permintaan yang pasti gagal)
 * DAN diulang di bawah kunci siswa (sumber kebenaran).
 */
async function assessLeave(db: Tx, school: LeaveSchool, studentId: string, input: LeaveRangeFields, hasAttachment: boolean): Promise<LocalDate[]> {
  const schoolDays = await schoolDaysIn(db, school, input);
  assertNoViolation(checkLeaveDays({ type: input.type, schoolDayCount: schoolDays.length, hasAttachment }));
  const candidates = await db.leaveRequest.findMany({
    where: {
      schoolId: school.id,
      studentId,
      status: { in: ["PENDING", "APPROVED"] },
      startDate: { lte: toDbDate(input.endDate) },
      endDate: { gte: toDbDate(input.startDate) },
    },
    select: { id: true, startDate: true, endDate: true, status: true },
    take: 5,
  });
  const ranges = candidates.map((c) => ({ id: c.id, status: c.status, startDate: fromDbDate(c.startDate), endDate: fromDbDate(c.endDate) }));
  const overlap = findOverlappingLeave(input, ranges);
  if (overlap) {
    throw conflict("LEAVE_OVERLAP", `Sudah ada pengajuan izin (${overlap.startDate} s.d. ${overlap.endDate}) yang beririsan dengan tanggal ini.`, {
      leaveRequestId: overlap.id,
      status: overlap.status,
    });
  }
  return schoolDays;
}

// ----------------------------------------------------------------------------- lampiran

/** Proses foto di luar transaksi: guard disk (503) lalu pipeline gambar (re-encode, EXIF dibuang). */
async function prepareAttachment(file: File | undefined): Promise<ProcessedImage | null> {
  if (!file) return null;
  await assertDiskSpace(storageRoot());
  return processImage(new Uint8Array(await file.arrayBuffer()), "LEAVE_ATTACHMENT");
}

/** Kuota unggah bersama (limiter UPLOAD, kunci sama dengan pipeline `rateLimit: {key: "user"}`). */
function consumeUploadQuota(userId: string): void {
  const key = `u:${userId}`;
  assertRateLimit("UPLOAD", key);
  getLimiter("UPLOAD").hit(key);
}

/**
 * withTx (+ ulang bila bentrok auto-ALPHA) dengan pelacakan berkas: setiap percobaan menulis paling banyak
 * satu berkas lewat `attach()`. Berhasil -> berkas percobaan terakhir dipertahankan, sisanya dibuang;
 * gagal -> semua berkas dibuang (tanpa berkas yatim).
 */
async function withLeaveTx<T>(upload: PendingUpload | null, ctx: ActionContext, work: (tx: Tx, attach: AttachFn) => Promise<T>): Promise<T> {
  const written: string[] = [];
  const state = { committedKey: null as string | null };
  const attempt = (tx: Tx): Promise<T> => {
    state.committedKey = null;
    const attach: AttachFn = async () => {
      if (!upload) return null;
      const saved = await persistProcessedFile(
        tx,
        { kind: "LEAVE_ATTACHMENT", processed: upload.processed, uploadedById: upload.uploadedById, schoolId: upload.schoolId, bucket: "private", attachedAt: ctx.now },
        ctx.now,
      );
      written.push(saved.storageKey);
      state.committedKey = saved.storageKey;
      return saved.id;
    };
    return work(tx, attach);
  };
  try {
    const result = await withMaterializeRetry(() => withTx(attempt));
    await Promise.all(written.filter((key) => key !== state.committedKey).map(discardFile));
    return result;
  } catch (error) {
    await Promise.all(written.map(discardFile));
    throw error;
  }
}

// ----------------------------------------------------------------------------- siswa

/** POST /student/leave-requests: PENDING + notifikasi LEAVE_SUBMITTED ke admin sekolah aktif. */
export async function createOwnLeave(ctx: ActionContext, input: CreateLeaveInput): Promise<LeaveRequestDto> {
  const self = studentSelf(requirePrincipal(ctx));
  const school = await loadLeaveSchool(prisma, self.schoolId);
  assertRange(input, school, ctx.now, "STUDENT");
  const hasAttachment = input.attachment !== undefined;
  await assessLeave(prisma, school, self.studentId, input, hasAttachment);
  const processed = await prepareAttachment(input.attachment);
  const upload = processed ? { processed, uploadedById: self.userId, schoolId: school.id } : null;
  const id = await withLeaveTx(upload, ctx, async (tx, attach) => {
    const student = await lockStudentForLeave(tx, school, self.studentId);
    if (student.status !== "ACTIVE") throw forbidden("STUDENT_NOT_ACTIVE", "Akun siswa tidak aktif untuk aksi ini.");
    await assessLeave(tx, school, student.id, input, hasAttachment);
    const attachmentFileId = await attach();
    const leave = await tx.leaveRequest.create({
      data: {
        schoolId: school.id, studentId: student.id, type: input.type, reason: input.reason, attachmentFileId,
        startDate: toDbDate(input.startDate), endDate: toDbDate(input.endDate), createdAt: ctx.now,
      },
      select: { id: true },
    });
    const event = leaveSubmittedNotification({
      leaveId: leave.id, type: input.type, startDate: input.startDate, endDate: input.endDate, studentName: student.name, className: student.className,
    });
    await notifySchoolAdmins(tx, school.id, event, ctx);
    return leave.id;
  });
  return getOwnLeave(ctx, id);
}

/** POST /student/leave-requests/{id}/cancel: compare-and-set PENDING -> CANCELLED milik sendiri. */
export async function cancelOwnLeave(ctx: ActionContext, id: string): Promise<LeaveRequestDto> {
  const self = studentSelf(requirePrincipal(ctx));
  await withTx(async (tx) => {
    const owned = { id, schoolId: self.schoolId, studentId: self.studentId };
    const updated = await tx.leaveRequest.updateMany({ where: { ...owned, status: "PENDING" }, data: { status: "CANCELLED" } });
    if (updated.count === 1) return;
    const current = await tx.leaveRequest.findFirst({ where: owned, select: { status: true } });
    if (!current) throw notFoundLeave();
    throw conflict("LEAVE_NOT_PENDING", "Hanya pengajuan berstatus Menunggu yang dapat dibatalkan.", { status: current.status });
  });
  return getOwnLeave(ctx, id);
}

// ----------------------------------------------------------------------------- admin

interface ReviewTarget {
  readonly id: string;
  readonly studentId: string;
  readonly type: LeaveTypeValue;
  readonly startDate: LocalDate;
  readonly endDate: LocalDate;
  readonly status: string;
}

async function findReviewTarget(db: Tx, scope: SchoolScope, id: string): Promise<ReviewTarget> {
  const row = await db.leaveRequest.findFirst({
    where: { id, schoolId: scope.schoolId },
    select: { id: true, studentId: true, type: true, startDate: true, endDate: true, status: true },
  });
  if (!row) throw notFoundLeave();
  return { ...row, startDate: fromDbDate(row.startDate), endDate: fromDbDate(row.endDate) };
}

/** Kunci siswa -> kunci baris izin -> baca ulang; wajib masih PENDING dan siswa AKTIF. */
async function lockForApproval(tx: Tx, scope: SchoolScope, school: LeaveSchool, target: ReviewTarget): Promise<{ student: LockedStudent; leave: ReviewTarget }> {
  const { id } = target;
  const student = await lockStudentForLeave(tx, school, target.studentId);
  await lockRows(tx, "LeaveRequest", [id]);
  const leave = await findReviewTarget(tx, scope, id);
  if (leave.status !== "PENDING") throw alreadyReviewed(leave.status);
  if (student.status !== "ACTIVE") {
    throw conflict("LEAVE_STUDENT_INACTIVE", "Siswa tidak berstatus Aktif; izin tidak dapat disetujui.", { studentStatus: student.status });
  }
  return { student, leave };
}

interface ReviewWrite {
  readonly status: "APPROVED" | "REJECTED";
  readonly note: string | null;
}

/** Compare-and-set PENDING -> APPROVED/REJECTED + peninjau. */
async function markReviewed(tx: Tx, scope: SchoolScope, id: string, review: ReviewWrite, ctx: ActionContext): Promise<number> {
  const updated = await tx.leaveRequest.updateMany({
    where: { id, schoolId: scope.schoolId, status: "PENDING" },
    data: { status: review.status, reviewedById: requirePrincipal(ctx).userId, reviewedAt: ctx.now, reviewNote: review.note },
  });
  return updated.count;
}

/** Materialisasi izin untuk siswa yang sudah dikunci (kelas snapshot + batas aktivasi dari baris siswa). */
function materializeFor(tx: Tx, school: LeaveSchool, student: LockedStudent, leave: ReviewTarget, schoolDays: readonly LocalDate[]): Promise<MaterializeResult> {
  return materializeLeave(tx, {
    schoolId: school.id,
    studentId: student.id,
    classId: student.currentClassId,
    leaveId: leave.id,
    type: leave.type,
    startDate: leave.startDate,
    endDate: leave.endDate,
    schoolDays,
    enrolledFrom: student.enrolledFrom,
  });
}

/** Audit persetujuan; `before` null untuk izin yang dicatat admin (baris baru). */
function approvalAudit(action: string, scope: SchoolScope, leave: ReviewTarget, note: string | null, materialized: MaterializeResult, before: unknown) {
  return {
    action,
    entityType: "LeaveRequest",
    entityId: leave.id,
    schoolId: scope.schoolId,
    before,
    after: { status: "APPROVED", studentId: leave.studentId, type: leave.type, startDate: leave.startDate, endDate: leave.endDate, note, materialized },
  };
}

/** POST /school/leave-requests/{id}/approve. */
export async function approveLeave(ctx: ActionContext, schoolId: string | undefined, id: string, input: ApproveLeaveInput): Promise<LeaveDecisionDto> {
  const scope = leaveScopeOf(ctx, schoolId);
  const school = await loadLeaveSchool(prisma, scope.schoolId);
  const target = await findReviewTarget(prisma, scope, id);
  const note = input.note || null;
  const materialized = await withMaterializeRetry(() =>
    withTx(async (tx) => {
      const { student, leave } = await lockForApproval(tx, scope, school, target);
      const result = await materializeFor(tx, school, student, leave, await schoolDaysIn(tx, school, leave));
      if ((await markReviewed(tx, scope, id, { status: "APPROVED", note }, ctx)) !== 1) throw alreadyReviewed(leave.status);
      await notifyStudents(tx, [student.id], leaveApprovedNotification({ leaveId: id, ...leave, note, enteredByAdmin: false }), ctx);
      await writeAudit(tx, approvalAudit("leave.approve", scope, leave, note, result, { status: leave.status }), ctx);
      return result;
    }),
  );
  return { leaveRequest: await loadSchoolLeaveItem(prisma, scope, id), materialized };
}

/** POST /school/leave-requests/{id}/reject: CAS PENDING -> REJECTED; absensi tidak disentuh. */
export async function rejectLeave(ctx: ActionContext, schoolId: string | undefined, id: string, input: RejectLeaveInput): Promise<SchoolLeaveDto> {
  const scope = leaveScopeOf(ctx, schoolId);
  await loadLeaveSchool(prisma, scope.schoolId);
  await withTx(async (tx) => {
    const count = await markReviewed(tx, scope, id, { status: "REJECTED", note: input.note }, ctx);
    const leave = await findReviewTarget(tx, scope, id);
    if (count !== 1) throw alreadyReviewed(leave.status);
    await notifyStudents(tx, [leave.studentId], leaveRejectedNotification({ leaveId: id, ...leave, note: input.note }), ctx);
    await writeAudit(
      tx,
      { action: "leave.reject", entityType: "LeaveRequest", entityId: id, schoolId: scope.schoolId, before: { status: "PENDING" }, after: { status: "REJECTED", note: input.note } },
      ctx,
    );
  });
  return loadSchoolLeaveItem(prisma, scope, id);
}

async function assertStudentInScope(scope: SchoolScope, studentId: string): Promise<void> {
  const row = await prisma.student.findFirst({ where: { id: studentId, schoolId: scope.schoolId }, select: { id: true } });
  if (!row) throw notFoundStudent();
}

/** POST /school/leave-requests: izin dicatat admin atas nama siswa, langsung APPROVED + dimaterialisasi. */
export async function createLeaveOnBehalf(ctx: ActionContext, schoolId: string | undefined, input: CreateLeaveOnBehalfInput): Promise<LeaveDecisionDto> {
  const scope = leaveScopeOf(ctx, schoolId);
  const principal = requirePrincipal(ctx);
  const school = await loadLeaveSchool(prisma, scope.schoolId);
  assertRange(input, school, ctx.now, "ADMIN");
  await assertStudentInScope(scope, input.studentId);
  const hasAttachment = input.attachment !== undefined;
  await assessLeave(prisma, school, input.studentId, input, hasAttachment);
  if (hasAttachment) consumeUploadQuota(principal.userId);
  const processed = await prepareAttachment(input.attachment);
  const upload = processed ? { processed, uploadedById: principal.userId, schoolId: school.id } : null;
  const note = input.note || null;
  const outcome = await withLeaveTx(upload, ctx, async (tx, attach) => {
    const student = await lockStudentForLeave(tx, school, input.studentId);
    if (student.status !== "ACTIVE") {
      throw conflict("LEAVE_STUDENT_INACTIVE", "Siswa tidak berstatus Aktif; izin tidak dapat dicatat.", { studentStatus: student.status });
    }
    const schoolDays = await assessLeave(tx, school, student.id, input, hasAttachment);
    const leave = await tx.leaveRequest.create({
      data: {
        schoolId: school.id, studentId: student.id, type: input.type, reason: input.reason, attachmentFileId: await attach(),
        startDate: toDbDate(input.startDate), endDate: toDbDate(input.endDate), status: "APPROVED",
        reviewedById: principal.userId, reviewedAt: ctx.now, reviewNote: note, createdAt: ctx.now,
      },
      select: { id: true },
    });
    const target: ReviewTarget = { id: leave.id, studentId: student.id, type: input.type, startDate: input.startDate, endDate: input.endDate, status: "APPROVED" };
    const result = await materializeFor(tx, school, student, target, schoolDays);
    await notifyStudents(tx, [student.id], leaveApprovedNotification({ leaveId: leave.id, ...target, note, enteredByAdmin: true }), ctx);
    await writeAudit(tx, approvalAudit("leave.create_on_behalf", scope, target, note, result, null), ctx);
    return { id: leave.id, materialized: result };
  });
  return { leaveRequest: await loadSchoolLeaveItem(prisma, scope, outcome.id), materialized: outcome.materialized };
}
