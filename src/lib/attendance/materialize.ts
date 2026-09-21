import type { Tx } from "@/lib/db";
import { conflict } from "@/lib/http/errors";
import { log } from "@/lib/log";
import { uniqueIndexOf } from "@/lib/students/unique-error";
import { fromDbDate, toDbDate, type LocalDate } from "@/lib/time/zone";
import { MATERIALIZE_MAX_RETRIES, type LeaveTypeValue } from "./leave-constants";
import { planLeaveMaterialization, type LeaveSkipReason } from "./leave-rules";

/**
 * Materialisasi izin/sakit yang DISETUJUI menjadi baris Attendance (D9/D10): setiap hari sekolah dalam
 * rentang (lampau, hari ini, mendatang) -> baris LEAVE; baris AUTO_ALPHA dikonversi; CHECKIN/ADMIN/LEAVE
 * dipertahankan. Pemanggil WAJIB sudah memegang kunci `attendance:<studentId>` + Student FOR UPDATE +
 * LeaveRequest FOR UPDATE (urutan kunci global src/lib/tx.ts).
 *
 * Ekspor untuk domain absensi lain:
 * - `leaveCoversDate`, `planLeaveMaterialization` (murni, dari leave-rules.ts).
 * - `isAttendanceDuplicate(error)` — P2002 pada kunci unik Attendance (studentId, date).
 * - `withMaterializeRetry(run)` — ulangi seluruh transaksi bila insert bentrok dengan auto-ALPHA.
 */
export { leaveCoversDate, planLeaveMaterialization } from "./leave-rules";

export interface LeaveMaterializeTarget {
  readonly schoolId: string;
  readonly studentId: string;
  /** Snapshot kelas siswa saat ini (Student.currentClassId). */
  readonly classId: string | null;
  readonly leaveId: string;
  readonly type: LeaveTypeValue;
  readonly startDate: LocalDate;
  readonly endDate: LocalDate;
  /** Hari sekolah dalam rentang (listSchoolDays). */
  readonly schoolDays: readonly LocalDate[];
  /** Tanggal pertama siswa wajib absen (firstEligibleDate); hari sebelumnya dilewati NOT_ENROLLED (null = tanpa batas). */
  readonly enrolledFrom: LocalDate | null;
}

export interface MaterializeResult {
  readonly created: LocalDate[];
  readonly converted: LocalDate[];
  readonly skipped: { date: LocalDate; reason: LeaveSkipReason }[];
}

async function existingRows(tx: Tx, target: LeaveMaterializeTarget) {
  const rows = await tx.attendance.findMany({
    where: { schoolId: target.schoolId, studentId: target.studentId, date: { gte: toDbDate(target.startDate), lte: toDbDate(target.endDate) } },
    select: { id: true, date: true, source: true },
  });
  return rows.map((row) => ({ id: row.id, date: fromDbDate(row.date), source: row.source }));
}

export async function materializeLeave(tx: Tx, target: LeaveMaterializeTarget): Promise<MaterializeResult> {
  const plan = planLeaveMaterialization(target.schoolDays, await existingRows(tx, target), target.enrolledFrom);
  if (plan.create.length > 0) {
    await tx.attendance.createMany({
      data: plan.create.map((date) => ({
        schoolId: target.schoolId,
        studentId: target.studentId,
        classId: target.classId,
        date: toDbDate(date),
        status: target.type,
        source: "LEAVE" as const,
        leaveRequestId: target.leaveId,
      })),
    });
  }
  for (const row of plan.convert) {
    // Compare-and-set: hanya baris yang MASIH Alpha otomatis yang dikonversi.
    const updated = await tx.attendance.updateMany({
      where: { id: row.id, studentId: target.studentId, source: "AUTO_ALPHA" },
      data: { status: target.type, source: "LEAVE", leaveRequestId: target.leaveId },
    });
    if (updated.count !== 1) throw conflict("CONFLICT_RETRY", "Data absensi berubah bersamaan. Silakan ulangi.");
  }
  return { created: plan.create, converted: plan.convert.map((row) => row.date), skipped: plan.skipped };
}

/** P2002 pada kunci unik Attendance (studentId, date) — mis. auto-ALPHA menyisipkan baris bersamaan. */
export function isAttendanceDuplicate(error: unknown): boolean {
  const index = uniqueIndexOf(error);
  return index !== null && /Attendance_studentId_date_key|studentId,\s*date/.test(index);
}

/**
 * Jalankan ulang transaksi (fungsi `run` membuka withTx sendiri) bila insert baris absensi bentrok dengan
 * penulis lain; percobaan berikutnya membaca baris baru itu lalu mengonversinya. Habis -> 409 CONFLICT_RETRY.
 */
export async function withMaterializeRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (!isAttendanceDuplicate(error)) throw error;
      if (attempt >= MATERIALIZE_MAX_RETRIES) throw conflict("CONFLICT_RETRY", "Data absensi berubah bersamaan. Silakan ulangi.");
      log.warn("leave.materialize_retry", { attempt });
    }
  }
}
