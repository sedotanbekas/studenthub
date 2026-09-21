import { formatMinute, localParts, type SchoolTz } from "@/lib/time/zone";
import { ANOMALY_LABELS, ANOMALY_SEVERITY, parseFlags, type AnomalyCode, type AnomalySeverity } from "./anomaly-rules";
import type { AttendanceStatusValue } from "./attendance-stats";

/**
 * Pemetaan baris absensi ke DTO monitoring admin (murni; tipe baris struktural agar teruji tanpa Prisma).
 * Label alasan penolakan berbahasa Indonesia; label & keparahan flag anomali dari anomaly-rules.ts.
 */
export type AttendanceSourceValue = "CHECKIN" | "LEAVE" | "AUTO_ALPHA" | "ADMIN";
export type DecimalLike = { toString(): string } | string | number | null;

export interface FlagDetail {
  readonly code: AnomalyCode;
  readonly label: string;
  readonly severity: AnomalySeverity;
}

const REJECT_REASON_LABELS: Readonly<Record<string, string>> = Object.freeze({
  OUTSIDE_GEOFENCE: "Di luar area sekolah",
  GPS_ACCURACY_TOO_LOW: "Akurasi GPS terlalu rendah",
  MOCK_LOCATION: "Lokasi palsu (fake GPS)",
  LOCATION_STALE: "Lokasi GPS kedaluwarsa",
  INVALID_LOCATION: "Lokasi tidak valid",
});

const labelOf = (labels: Readonly<Record<string, string>>, code: string): string => (Object.hasOwn(labels, code) ? (labels[code] ?? code) : code);

export const rejectReasonLabel = (reason: string): string => labelOf(REJECT_REASON_LABELS, reason);

/** Detail flag untuk tampilan admin: label Indonesia + tingkat keparahan (sumber: anomaly-rules.ts). */
export function flagDetails(codes: readonly AnomalyCode[]): FlagDetail[] {
  return codes.map((code) => ({ code, label: ANOMALY_LABELS[code], severity: ANOMALY_SEVERITY[code] }));
}

export function decimalToNumber(value: DecimalLike): number | null {
  return value === null ? null : Number(value.toString());
}

/** Jam lokal sekolah "HH:mm" dari instant UTC. */
export function timeLocal(instant: Date | null, tz: SchoolTz): string | null {
  return instant === null ? null : formatMinute(localParts(instant, tz).minuteOfDay);
}

/** Tautan unduhan berkas privat (route GET /api/v1/files/{id}). */
export const fileUrl = (fileId: string): string => `/api/v1/files/${encodeURIComponent(fileId)}`;

export interface StudentRowLike {
  readonly id: string;
  readonly nis: string;
  readonly nisn: string;
  readonly user: { readonly name: string };
  readonly currentClass: { readonly name: string } | null;
}

export interface StudentBrief {
  readonly id: string;
  readonly nis: string;
  readonly nisn: string;
  readonly name: string;
  readonly className: string | null;
}

/** className: kelas snapshot baris absensi bila ada, selain itu kelas siswa saat ini. */
export function toStudentBrief(row: StudentRowLike, snapshotClassName?: string | null): StudentBrief {
  return { id: row.id, nis: row.nis, nisn: row.nisn, name: row.user.name, className: snapshotClassName ?? row.currentClass?.name ?? null };
}

export interface AttendanceRowLike {
  readonly id: string;
  readonly status: AttendanceStatusValue;
  readonly source: AttendanceSourceValue;
  readonly checkInAt: Date | null;
  readonly lateMinutes: number | null;
  readonly distanceM: number | null;
  readonly accuracyM: number | null;
  readonly hasAnomaly: boolean;
  readonly anomalyFlags: unknown;
  readonly leaveRequestId: string | null;
  readonly note: string | null;
}

export interface AttendanceBrief {
  readonly id: string;
  readonly status: AttendanceStatusValue;
  readonly source: AttendanceSourceValue;
  readonly checkInTimeLocal: string | null;
  readonly lateMinutes: number | null;
  readonly distanceM: number | null;
  readonly accuracyM: number | null;
  readonly hasAnomaly: boolean;
  readonly flags: AnomalyCode[];
  readonly leaveRequestId: string | null;
  readonly note: string | null;
}

export function toAttendanceBrief(row: AttendanceRowLike, tz: SchoolTz): AttendanceBrief {
  return {
    id: row.id,
    status: row.status,
    source: row.source,
    checkInTimeLocal: timeLocal(row.checkInAt, tz),
    lateMinutes: row.lateMinutes,
    distanceM: row.distanceM,
    accuracyM: row.accuracyM,
    hasAnomaly: row.hasAnomaly,
    flags: parseFlags(row.anomalyFlags),
    leaveRequestId: row.leaveRequestId,
    note: row.note,
  };
}

export interface RejectionRowLike<R extends string = string> {
  readonly id: string;
  readonly reason: R;
  readonly latitude: DecimalLike;
  readonly longitude: DecimalLike;
  readonly accuracyM: number | null;
  readonly distanceM: number | null;
  readonly isMocked: boolean | null;
  readonly deviceId: string | null;
  readonly createdAt: Date;
}

export interface RejectionBrief<R extends string = string> {
  readonly id: string;
  readonly reason: R;
  readonly reasonLabel: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly accuracyM: number | null;
  readonly distanceM: number | null;
  readonly isMocked: boolean | null;
  readonly deviceId: string | null;
  readonly timeLocal: string;
  readonly createdAt: string;
}

export function toRejectionBrief<R extends string>(row: RejectionRowLike<R>, tz: SchoolTz): RejectionBrief<R> {
  return {
    id: row.id,
    reason: row.reason,
    reasonLabel: rejectReasonLabel(row.reason),
    latitude: decimalToNumber(row.latitude),
    longitude: decimalToNumber(row.longitude),
    accuracyM: row.accuracyM,
    distanceM: row.distanceM,
    isMocked: row.isMocked,
    deviceId: row.deviceId,
    timeLocal: timeLocal(row.createdAt, tz) ?? "00:00",
    createdAt: row.createdAt.toISOString(),
  };
}
