import type { ActionContext } from "@/lib/auth/principal";
import type { Tx } from "@/lib/db";
import { conflict, unprocessable, type AppError } from "@/lib/http/errors";
import { attendanceLockKey } from "@/lib/lock-keys";
import { assertDiskSpace } from "@/lib/storage/disk";
import { storageRoot } from "@/lib/storage/driver";
import { discardFile, persistProcessedFile } from "@/lib/storage/files";
import { processImage, type ProcessedImage } from "@/lib/storage/image";
import { lockKey, withTx } from "@/lib/tx";
import type { LocationFix } from "./check-in-rules";
import { findAttendance, loadCheckInContext, type CheckInContext } from "./check-in-context";
import { lockActiveStudent, locationFixOf } from "./check-in-service";
import { checkOutMessage, checkOutRejectMessage, decideCheckOut, type CheckOutDecisionInput, type CheckOutRejection } from "./check-out-rules";
import { STORED_COORD_DECIMALS } from "./constants";
import { ATTENDANCE_ROW_SELECT, checkOutRecordState, toCheckOutAttendanceDto, type AttendanceRow } from "./student-dto";
import type { CheckOutBody, CheckOutResultDto } from "./student-schemas";

/**
 * Absen pulang siswa (permintaan pemilik 2026-10-07; multipart selfie + lokasi, sama dengan check-in).
 * Keputusan murni decideCheckOut -> selfie hanya di-decode bila DITERIMA -> tulis: kunci attendance:<studentId>
 * PALING AWAL (kunci yang sama dengan check-in), Student FOR UPDATE (status dibaca ulang), baca ulang baris hari ini
 * di bawah kunci dan putuskan ulang (sudah pulang -> 409 ALREADY_CHECKED_OUT tanpa menulis berkas), simpan berkas +
 * StoredFile, lalu isi kolom checkOut* lewat compare-and-set (checkOutAt masih NULL). Berkas yang tidak ter-commit
 * selalu dihapus. Tanpa flag anomali & tanpa catatan percobaan ditolak (CheckInRejection khusus absen masuk).
 */
interface WritePlan {
  readonly context: CheckInContext;
  readonly now: Date;
  readonly fix: LocationFix;
  readonly deviceId: string;
  readonly distanceM: number;
  readonly processed: ProcessedImage;
}

export function checkOutInputOf(context: CheckInContext, record: AttendanceRow | null, fix: LocationFix): CheckOutDecisionInput {
  return {
    record: checkOutRecordState(record, context.school.timezone),
    day: context.day,
    minuteOfDay: context.local.minuteOfDay,
    openMinute: context.school.checkOutOpenMinute,
    geofence: context.school.geofence,
    fix,
    testMode: context.testMode,
  };
}

/** Sudah absen pulang -> 409 (percobaan kedua); penolakan lain -> 422. Detail dikirim apa adanya. */
export function checkOutError(rejection: CheckOutRejection): AppError {
  const message = checkOutRejectMessage(rejection);
  if (rejection.code === "ALREADY_CHECKED_OUT") return conflict(rejection.code, message, rejection.details);
  return unprocessable(rejection.code, message, rejection.details);
}

export async function checkOut(body: CheckOutBody, ctx: ActionContext): Promise<CheckOutResultDto> {
  const context = await loadCheckInContext(ctx);
  const fix = locationFixOf(body);
  const decision = decideCheckOut(checkOutInputOf(context, context.existing, fix));
  if (decision.kind === "REJECT") throw checkOutError(decision.rejection);
  await assertDiskSpace(storageRoot());
  const processed = await processImage(new Uint8Array(await body.selfie.arrayBuffer()), "ATTENDANCE_SELFIE");
  const row = await writeCheckOut({ context, now: ctx.now, fix, deviceId: body.deviceId, distanceM: decision.distanceM, processed });
  const attendance = toCheckOutAttendanceDto(row, context.school.timezone);
  return { attendance, message: checkOutMessage(attendance.checkOutTimeLocal) };
}

async function discardAll(keys: readonly string[]): Promise<void> {
  await Promise.all(keys.map((key) => discardFile(key)));
}

/** withTx bisa mengulang transaksi (deadlock): berkas dari percobaan yang di-rollback ikut dihapus. */
async function writeCheckOut(plan: WritePlan): Promise<AttendanceRow> {
  const written: string[] = [];
  try {
    const outcome = await withTx((tx) => writeInTx(tx, plan, written));
    await discardAll(written.filter((key) => key !== outcome.storageKey));
    return outcome.row;
  } catch (error) {
    await discardAll(written);
    throw error;
  }
}

async function writeInTx(tx: Tx, plan: WritePlan, written: string[]): Promise<{ row: AttendanceRow; storageKey: string }> {
  const { student } = plan.context;
  await lockKey(tx, attendanceLockKey(student.id));
  await lockActiveStudent(tx, student);
  const existing = await findAttendance(tx, student, plan.context.local.ymd);
  // Putuskan ulang di bawah kunci: absen pulang bersamaan / koreksi admin yang baru ter-commit menang.
  const recheck = decideCheckOut(checkOutInputOf(plan.context, existing, plan.fix));
  if (recheck.kind === "REJECT" || existing === null) throw checkOutError(recheck.kind === "REJECT" ? recheck.rejection : { code: "NOT_CHECKED_IN", details: null });
  const file = await persistProcessedFile(
    tx,
    { kind: "ATTENDANCE_SELFIE", processed: plan.processed, uploadedById: student.userId, schoolId: student.schoolId, bucket: "private", attachedAt: plan.now },
    plan.now,
  );
  written.push(file.storageKey);
  const { count } = await tx.attendance.updateMany({
    where: { id: existing.id, schoolId: student.schoolId, checkOutAt: null, checkInAt: { not: null } },
    data: {
      checkOutAt: plan.now,
      checkOutLatitude: plan.fix.latitude.toFixed(STORED_COORD_DECIMALS),
      checkOutLongitude: plan.fix.longitude.toFixed(STORED_COORD_DECIMALS),
      checkOutAccuracyM: Math.round(plan.fix.accuracyM ?? 0),
      checkOutDistanceM: plan.distanceM,
      checkOutDeviceId: plan.deviceId,
      checkOutSelfieFileId: file.id,
    },
  });
  if (count !== 1) throw conflict("CONFLICT_RETRY", "Terjadi bentrokan data bersamaan. Silakan ulangi.");
  const row = await tx.attendance.findFirst({ where: { id: existing.id, schoolId: student.schoolId }, select: ATTENDANCE_ROW_SELECT });
  if (!row) throw conflict("CONFLICT_RETRY", "Terjadi bentrokan data bersamaan. Silakan ulangi.");
  return { row, storageKey: file.storageKey };
}
