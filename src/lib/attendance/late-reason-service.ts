import { writeAudit } from "@/lib/audit";
import type { ActionContext } from "@/lib/auth/principal";
import type { Tx } from "@/lib/db";
import { conflict, forbidden, unprocessable, type AppError } from "@/lib/http/errors";
import { attendanceLockKey } from "@/lib/lock-keys";
import { fromDbDate, localParts, toDbDate, type SchoolTz } from "@/lib/time/zone";
import { lockKey, withTx } from "@/lib/tx";
import { loadStudentSchool, type CheckInStudent } from "./check-in-context";
import {
  isSameLateReason,
  lateReasonBlock,
  lateReasonClock,
  lateReasonNoteLength,
  lateReasonSavedMessage,
  toLateReasonDto,
  type LateReasonBlock,
  type LateReasonClock,
  type LateReasonValue,
} from "./late-reason-rules";
import type { LateReasonBody, LateReasonResultDto } from "./late-reason-schemas";

/**
 * Siswa mengisi/mengubah alasan terlambat absensi HARI INI (A1, keputusan pemilik 2026-10-03).
 * Urutan kunci: AppLock `attendance:<studentId>` (mutex yang sama dengan check-in & koreksi) -> baca ulang status
 * Student -> Attendance (compare-and-set) -> AuditLog. Tanpa notifikasi. Alasan bukan bukti lokasi, jadi sesi tidak
 * harus mobile. Audit hanya mencatat kategori & panjang keterangan: teks bebas siswa (mungkin soal kesehatan) tidak
 * disalin ke log audit yang permanen; keterangan terkini tetap terlihat di catatan absensi.
 */

const LATE_REASON_SELECT = {
  id: true,
  date: true,
  status: true,
  source: true,
  lateReasonCategory: true,
  lateReasonNote: true,
  lateReasonAt: true,
} as const;

const BLOCK_ERRORS: Readonly<Record<LateReasonBlock, () => AppError>> = {
  NO_RECORD: () => unprocessable("NO_ATTENDANCE_TODAY", "Belum ada absensi hari ini, jadi belum ada alasan yang perlu diisi."),
  DAY_CLOSED: () => unprocessable("LATE_REASON_DAY_CLOSED", "Hari sekolah sudah selesai, jadi alasan terlambat tidak bisa diisi atau diubah lagi."),
  LOCKED: () => conflict("LATE_REASON_LOCKED", "Absensi hari ini sudah dicatat ulang sekolah, jadi alasan tidak bisa diubah lagi."),
  NOT_LATE: () => unprocessable("ATTENDANCE_NOT_LATE", "Absensi hari ini tidak tercatat terlambat, jadi alasan tidak diperlukan."),
};
const inactive = (): AppError => forbidden("STUDENT_NOT_ACTIVE", "Akun siswa tidak aktif untuk absensi.");

/** Jejak audit tanpa teks bebas. */
const auditValue = (value: LateReasonValue | null) => value && { category: value.category, noteLength: value.note === null ? 0 : lateReasonNoteLength(value.note) };

const raceConflict = (): AppError => conflict("CONFLICT_RETRY", "Absensi berubah bersamaan. Silakan ulangi.");

interface ReasonRequest {
  readonly student: CheckInStudent;
  readonly clock: LateReasonClock;
  readonly tz: SchoolTz;
  readonly value: LateReasonValue;
}

async function applyLateReason(tx: Tx, request: ReasonRequest, ctx: ActionContext): Promise<LateReasonResultDto> {
  const { student, clock, tz, value } = request;
  await lockKey(tx, attendanceLockKey(student.id));
  const current = await tx.student.findFirst({ where: { id: student.id, schoolId: student.schoolId }, select: { status: true } });
  if (current?.status !== "ACTIVE") throw inactive();
  const row = await tx.attendance.findFirst({ where: { studentId: student.id, schoolId: student.schoolId, date: toDbDate(clock.today) }, select: LATE_REASON_SELECT });
  const block = lateReasonBlock(row && { status: row.status, source: row.source, date: fromDbDate(row.date) }, clock);
  if (block !== null || row === null) throw BLOCK_ERRORS[block ?? "NO_RECORD"]();
  const stored = row.lateReasonCategory === null ? null : { category: row.lateReasonCategory, note: row.lateReasonNote };
  if (isSameLateReason(stored, value)) {
    const lateReason = toLateReasonDto(row, tz);
    if (lateReason) return { lateReason, unchanged: true, message: lateReasonSavedMessage(true) };
  }
  const data = { lateReasonCategory: value.category, lateReasonNote: value.note, lateReasonAt: ctx.now };
  const { count } = await tx.attendance.updateMany({ where: { id: row.id, schoolId: student.schoolId, status: "TERLAMBAT", source: "CHECKIN" }, data });
  if (count !== 1) throw raceConflict();
  await writeAudit(
    tx,
    {
      action: "attendance.late_reason",
      entityType: "Attendance",
      entityId: row.id,
      schoolId: student.schoolId,
      before: auditValue(stored),
      after: { ...auditValue(value), date: clock.today },
    },
    ctx,
  );
  const lateReason = toLateReasonDto(data, tz);
  if (!lateReason) throw raceConflict();
  return { lateReason, unchanged: false, message: lateReasonSavedMessage(false) };
}

/** PUT /student/attendance/today/late-reason. Hanya baris CHECKIN TERLAMBAT milik sendiri pada hari ini. */
export async function setOwnLateReason(body: LateReasonBody, ctx: ActionContext): Promise<LateReasonResultDto> {
  const { student, school } = await loadStudentSchool(ctx);
  if (student.status !== "ACTIVE") throw inactive();
  const clock = lateReasonClock(localParts(ctx.now, school.timezone), school.dayEndMinute);
  const request: ReasonRequest = { student, clock, tz: school.timezone, value: { category: body.category, note: body.note } };
  return withTx((tx) => applyLateReason(tx, request, ctx));
}
