import type { Prisma } from "@prisma/client";
import type { ActionContext } from "@/lib/auth/principal";
import type { Tx } from "@/lib/db";
import { conflict, isAppError, unprocessable, type AppError } from "@/lib/http/errors";
import { attendanceLockKey } from "@/lib/lock-keys";
import { ENUM_LABELS } from "@/lib/platform/enum-labels";
import { assertDiskSpace } from "@/lib/storage/disk";
import { storageRoot } from "@/lib/storage/driver";
import { discardFile, persistProcessedFile, type PersistFileInput } from "@/lib/storage/files";
import { processImage, type ProcessedImage } from "@/lib/storage/image";
import { toDbDate, type LocalDate } from "@/lib/time/zone";
import { lockKey, lockRows, withTx } from "@/lib/tx";
import { detectAnomalies, hasReportableAnomaly, mergeFlags, parseFlags, type AnomalyCode, type AnomalyInput } from "./anomaly-rules";
import {
  classifyExisting,
  decideCheckIn,
  distanceToSchool,
  isLocationRejection,
  rejectMessage,
  type CheckInDecision,
  type CheckInRejection,
  type LocationFix,
} from "./check-in-rules";
import { decisionInputOf, findAttendance, loadAnomalyEvidence, loadCheckInContext, type AnomalyEvidence, type CheckInContext } from "./check-in-context";
import { LEAVE_CONVERSION_NOTE, SHARED_DEVICE_MAX_ROWS, STORED_COORD_DECIMALS } from "./constants";
import { haversineMeters } from "./geo";
import { logRejectionSafely } from "./rejection-log";
import { ATTENDANCE_ROW_SELECT, checkInMessage, toCheckInAttendanceDto, type AttendanceRow } from "./student-dto";
import type { CheckInBody, CheckInResultDto } from "./student-schemas";

/**
 * Check-in siswa (multipart selfie + lokasi). Keputusan murni decideCheckIn -> selfie hanya di-decode
 * bila DITERIMA -> tulis: kunci attendance:<studentId> PALING AWAL, baca ulang baris hari ini di bawah
 * kunci (replay/409 tidak menulis berkas), simpan berkas + StoredFile + Attendance (atau konversi baris
 * LEAVE), tandai SHARED_DEVICE best effort. Berkas yang tidak ter-commit selalu dihapus.
 */
export interface CheckInOutcome {
  readonly result: CheckInResultDto;
  readonly status: 200 | 201;
}

type AcceptDecision = Extract<CheckInDecision, { kind: "ACCEPT" }>;
type TxOutcome =
  | { readonly kind: "REPLAY" | "CONFLICT"; readonly row: AttendanceRow }
  | { readonly kind: "CREATED"; readonly row: AttendanceRow; readonly storageKey: string };

interface WritePlan {
  readonly context: CheckInContext;
  readonly date: LocalDate;
  readonly now: Date;
  readonly fix: LocationFix;
  readonly deviceId: string;
  readonly decision: AcceptDecision;
  readonly processed: ProcessedImage;
  readonly anomaly: Omit<AnomalyInput, "sharedDevice">;
}

interface SharedDeviceRow {
  readonly id: string;
  readonly anomalyFlags: Prisma.JsonValue;
}

/** Percobaan ulang transaksi saat balapan unik (P2002) / konversi LEAVE bentrok. */
const RACE_ATTEMPTS = 2;

export interface FixInput {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracy?: number | null | undefined;
  readonly mocked?: boolean | null | undefined;
  readonly locationTimestamp: number;
  readonly clientTime: number;
}

export function locationFixOf(input: FixInput): LocationFix {
  return {
    latitude: input.latitude,
    longitude: input.longitude,
    accuracyM: input.accuracy ?? null,
    mocked: input.mocked ?? null,
    locationTimestampMs: input.locationTimestamp,
    clientTimeMs: input.clientTime,
  };
}

export async function checkIn(body: CheckInBody, ctx: ActionContext): Promise<CheckInOutcome> {
  const context = await loadCheckInContext(ctx);
  const fix = locationFixOf(body);
  const decision = decideCheckIn(decisionInputOf(context, fix));
  switch (decision.kind) {
    case "REPLAY":
      return replayOutcome(requireRow(context.existing), context);
    case "CONFLICT":
      throw alreadyRecorded(requireRow(context.existing));
    case "REJECT":
      return rejectCheckIn(context, { fix, deviceId: body.deviceId }, decision.rejection, ctx.now);
    case "ACCEPT":
      return acceptCheckIn(context, { fix, body, decision }, ctx);
  }
}

function requireRow(row: AttendanceRow | null): AttendanceRow {
  if (row === null) throw new Error("Keputusan REPLAY/CONFLICT tanpa baris absensi");
  return row;
}

function replayOutcome(row: AttendanceRow, context: CheckInContext): CheckInOutcome {
  const attendance = toCheckInAttendanceDto(row, context.school.timezone);
  return { status: 200, result: { attendance, replayed: true, message: checkInMessage(attendance, true) } };
}

function alreadyRecorded(row: AttendanceRow): AppError {
  const label = ENUM_LABELS.AttendanceStatus[row.status];
  const message =
    row.source === "AUTO_ALPHA"
      ? `Absensi hari ini sudah ditutup dengan status ${label}. Hubungi admin sekolah bila tidak sesuai.`
      : `Absensi hari ini sudah dicatat sekolah dengan status ${label}. Hubungi admin sekolah bila tidak sesuai.`;
  return conflict("ATTENDANCE_ALREADY_RECORDED", message, { status: row.status, source: row.source });
}

async function rejectCheckIn(
  context: CheckInContext,
  attempt: { fix: LocationFix; deviceId: string },
  rejection: CheckInRejection,
  now: Date,
): Promise<never> {
  const reason = rejection.code;
  if (isLocationRejection(reason)) {
    const distanceM = distanceToSchool(attempt.fix, context.school.geofence);
    const { student } = context;
    await logRejectionSafely({ schoolId: student.schoolId, studentId: student.id, date: context.local.ymd, reason, fix: attempt.fix, distanceM, deviceId: attempt.deviceId }, now);
  }
  throw unprocessable(reason, rejectMessage(rejection), rejection.details);
}

async function acceptCheckIn(
  context: CheckInContext,
  request: { fix: LocationFix; body: CheckInBody; decision: AcceptDecision },
  ctx: ActionContext,
): Promise<CheckInOutcome> {
  await assertDiskSpace(storageRoot());
  const processed = await processImage(new Uint8Array(await request.body.selfie.arrayBuffer()), "ATTENDANCE_SELFIE");
  const evidence = await loadAnomalyEvidence(context.student, ctx.now);
  const plan: WritePlan = {
    context,
    date: context.local.ymd,
    now: ctx.now,
    fix: request.fix,
    deviceId: request.body.deviceId,
    decision: request.decision,
    processed,
    anomaly: anomalyBase(context, request, processed, evidence, ctx.now),
  };
  const outcome = await writeCheckIn(plan);
  if (outcome.kind === "REPLAY") return replayOutcome(outcome.row, context);
  if (outcome.kind === "CONFLICT") throw alreadyRecorded(outcome.row);
  const attendance = toCheckInAttendanceDto(outcome.row, context.school.timezone);
  return { status: 201, result: { attendance, replayed: false, message: checkInMessage(attendance, false) } };
}

function anomalyBase(
  context: CheckInContext,
  request: { fix: LocationFix; body: CheckInBody },
  processed: ProcessedImage,
  evidence: AnomalyEvidence,
  now: Date,
): Omit<AnomalyInput, "sharedDevice"> {
  const { fix } = request;
  return {
    nowMs: now.getTime(),
    distanceM: haversineMeters(fix, context.school.geofence),
    radiusM: context.school.geofence.radiusM,
    accuracyM: fix.accuracyM ?? 0,
    locationTimestampMs: fix.locationTimestampMs,
    clientTimeMs: fix.clientTimeMs,
    requestDeviceId: request.body.deviceId,
    sessionDeviceId: context.principal.deviceId,
    deviceBoundAtMs: context.student.deviceBoundAt?.getTime() ?? null,
    deviceBeforeBinding: evidence.deviceBeforeBinding,
    selfiePhash: processed.phash,
    recentSelfiePhashes: evidence.recentSelfiePhashes,
  };
}

const raceConflict = (): AppError => conflict("CONFLICT_RETRY", "Terjadi bentrokan data bersamaan. Silakan ulangi.");

function isRace(error: unknown): boolean {
  if (isAppError(error)) return error.code === "CONFLICT_RETRY";
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

async function retryOnRace<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (!isRace(error)) throw error;
      if (attempt >= RACE_ATTEMPTS) throw raceConflict();
    }
  }
}

async function discardAll(keys: readonly string[]): Promise<void> {
  await Promise.all(keys.map((key) => discardFile(key)));
}

async function writeCheckIn(plan: WritePlan): Promise<TxOutcome> {
  const written: string[] = [];
  try {
    const outcome = await retryOnRace(() => withTx((tx) => writeInTx(tx, plan, written)));
    const committed = outcome.kind === "CREATED" ? outcome.storageKey : null;
    await discardAll(written.filter((key) => key !== committed));
    return outcome;
  } catch (error) {
    await discardAll(written);
    throw error;
  }
}

async function writeInTx(tx: Tx, plan: WritePlan, written: string[]): Promise<TxOutcome> {
  const { student } = plan.context;
  await lockKey(tx, attendanceLockKey(student.id));
  const existing = await findAttendance(tx, student, plan.date);
  const mode = classifyExisting(existing?.source ?? null);
  if (existing && (mode === "REPLAY" || mode === "CONFLICT")) return { kind: mode, row: existing };
  const shared = await lockSharedDeviceRows(tx, plan);
  const flags = detectAnomalies({ ...plan.anomaly, sharedDevice: shared.length > 0 });
  const file = await persistProcessedFile(tx, selfieFileInput(plan), plan.now);
  written.push(file.storageKey);
  const data = presenceData(plan, file.id, flags);
  const row = existing && mode === "CONVERT_LEAVE" ? await convertLeaveRow(tx, existing.id, plan, data) : await createRow(tx, plan, data);
  await flagSharedDevice(tx, student.schoolId, shared);
  return { kind: "CREATED", row, storageKey: file.storageKey };
}

function selfieFileInput(plan: WritePlan): PersistFileInput {
  const { student } = plan.context;
  return {
    kind: "ATTENDANCE_SELFIE",
    processed: plan.processed,
    uploadedById: student.userId,
    schoolId: student.schoolId,
    bucket: "private",
    attachedAt: plan.now,
  };
}

/** Kolom bersama baris CHECKIN (buat baru maupun konversi LEAVE). */
function presenceData(plan: WritePlan, selfieFileId: string, flags: readonly AnomalyCode[]) {
  return {
    status: plan.decision.status,
    source: "CHECKIN" as const,
    checkInAt: plan.now,
    lateMinutes: plan.decision.lateMinutes,
    latitude: plan.fix.latitude.toFixed(STORED_COORD_DECIMALS),
    longitude: plan.fix.longitude.toFixed(STORED_COORD_DECIMALS),
    accuracyM: Math.round(plan.fix.accuracyM ?? 0),
    distanceM: plan.decision.distanceM,
    isMocked: plan.fix.mocked,
    locationCapturedAt: new Date(plan.fix.locationTimestampMs),
    deviceId: plan.deviceId,
    selfieFileId,
    hasAnomaly: hasReportableAnomaly(flags),
    anomalyFlags: [...flags],
  };
}

type PresenceData = ReturnType<typeof presenceData>;

async function createRow(tx: Tx, plan: WritePlan, data: PresenceData): Promise<AttendanceRow> {
  const { student } = plan.context;
  return tx.attendance.create({
    data: { schoolId: student.schoolId, studentId: student.id, classId: student.currentClassId, date: toDbDate(plan.date), ...data },
    select: ATTENDANCE_ROW_SELECT,
  });
}

/** LEAVE -> CHECKIN via compare-and-set (leaveRequestId dipertahankan). */
async function convertLeaveRow(tx: Tx, id: string, plan: WritePlan, data: PresenceData): Promise<AttendanceRow> {
  const schoolId = plan.context.student.schoolId;
  const { count } = await tx.attendance.updateMany({ where: { id, schoolId, source: "LEAVE" }, data: { ...data, note: LEAVE_CONVERSION_NOTE } });
  if (count !== 1) throw raceConflict();
  const row = await tx.attendance.findFirst({ where: { id, schoolId }, select: ATTENDANCE_ROW_SELECT });
  if (!row) throw raceConflict();
  return row;
}

/** Baris check-in siswa LAIN di sekolah yang sama hari ini dengan deviceId sama (dikunci FOR UPDATE). */
async function lockSharedDeviceRows(tx: Tx, plan: WritePlan): Promise<SharedDeviceRow[]> {
  const { student } = plan.context;
  const candidates = await tx.attendance.findMany({
    where: { schoolId: student.schoolId, date: toDbDate(plan.date), deviceId: plan.deviceId, studentId: { not: student.id }, checkInAt: { not: null } },
    select: { id: true },
    orderBy: { id: "asc" },
    take: SHARED_DEVICE_MAX_ROWS,
  });
  if (candidates.length === 0) return [];
  const ids = await lockRows(tx, "Attendance", candidates.map((row) => row.id));
  return tx.attendance.findMany({ where: { id: { in: ids }, schoolId: student.schoolId }, select: { id: true, anomalyFlags: true } });
}

async function flagSharedDevice(tx: Tx, schoolId: string, rows: readonly SharedDeviceRow[]): Promise<void> {
  for (const row of rows) {
    if (parseFlags(row.anomalyFlags).includes("SHARED_DEVICE")) continue;
    await tx.attendance.updateMany({
      where: { id: row.id, schoolId },
      data: { anomalyFlags: mergeFlags(row.anomalyFlags, ["SHARED_DEVICE"]), hasAnomaly: true },
    });
  }
}
