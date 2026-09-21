import { toDbDate, type LocalDate } from "@/lib/time/zone";
import { withTx, lockKey } from "@/lib/tx";
import { log, safeErrorFields } from "@/lib/log";
import { rejectionLocation, type LocationFix, type LocationRejectCode } from "./check-in-rules";
import { attendanceLockKey } from "@/lib/lock-keys";
import { MAX_LOGGED_REJECTIONS_PER_DAY } from "./constants";

/**
 * Catatan percobaan check-in yang DITOLAK karena lokasi (tanpa selfie) untuk admin sekolah.
 * Maks 20 baris per siswa per hari lokal (dijaga kunci attendance:<studentId>); koordinat
 * dibulatkan/dibuang sesuai rejectionLocation. Kegagalan pencatatan tidak mengubah respons 422.
 */
export interface RejectionLogInput {
  readonly schoolId: string;
  readonly studentId: string;
  readonly date: LocalDate;
  readonly reason: LocationRejectCode;
  readonly fix: LocationFix;
  /** Jarak ke sekolah (meter, dibulatkan); null untuk (0,0). */
  readonly distanceM: number | null;
  readonly deviceId: string | null;
}

/** true bila tercatat; false bila kuota harian penuh. */
export async function logRejection(input: RejectionLogInput, now: Date): Promise<boolean> {
  return withTx(async (tx) => {
    await lockKey(tx, attendanceLockKey(input.studentId));
    const date = toDbDate(input.date);
    const logged = await tx.checkInRejection.count({ where: { studentId: input.studentId, schoolId: input.schoolId, date } });
    if (logged >= MAX_LOGGED_REJECTIONS_PER_DAY) return false;
    const location = rejectionLocation(input.fix, input.distanceM);
    await tx.checkInRejection.create({
      data: {
        schoolId: input.schoolId,
        studentId: input.studentId,
        date,
        reason: input.reason,
        latitude: location.latitude,
        longitude: location.longitude,
        accuracyM: location.accuracyM,
        distanceM: location.distanceM,
        isMocked: input.fix.mocked,
        deviceId: input.deviceId,
        createdAt: now,
      },
    });
    return true;
  });
}

/** Versi yang tidak pernah melempar: kegagalan dicatat di log, respons 422 ke siswa tetap sama. */
export async function logRejectionSafely(input: RejectionLogInput, now: Date): Promise<void> {
  try {
    await logRejection(input, now);
  } catch (error) {
    log.warn("attendance.rejection_log_failed", { studentId: input.studentId, reason: input.reason, ...safeErrorFields(error) });
  }
}
