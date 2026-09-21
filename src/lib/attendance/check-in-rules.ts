import type { DayReason } from "@/lib/calendar/rules";
import { formatMinute } from "@/lib/time/zone";
import {
  ACCURACY_TOLERANCE_CAP_M,
  BLOCK_MOCKED_LOCATION,
  FIX_AGE_REJECT_S,
  MAX_ACCEPTED_ACCURACY_M,
  MAX_LATE_MINUTES,
  REJECTION_COORD_DECIMALS,
  REJECTION_COORD_MAX_DISTANCE_M,
} from "./constants";
import { haversineMeters, isNullIsland, roundCoord, type GeoPoint } from "./geo";

/**
 * Keputusan check-in murni (tanpa Prisma, jam disuntikkan lewat minuteOfDay/fix). Dipakai check-in,
 * precheck, dan layar "hari ini" agar ketiganya selalu sepakat. Urutan (berhenti di aturan pertama):
 * baris yang ada -> hari sekolah -> jendela [buka, tutup) -> lokasi ((0,0) -> mocked -> umur fix ->
 * akurasi -> geofence) -> TERIMA (HADIR/TERLAMBAT).
 */
export type AttendanceSourceCode = "CHECKIN" | "LEAVE" | "AUTO_ALPHA" | "ADMIN";
export type CheckInMode = "CREATE" | "CONVERT_LEAVE" | "REPLAY" | "CONFLICT";
export type WindowState = "BEFORE_OPEN" | "OPEN" | "CLOSED";
export type PresenceStatus = "HADIR" | "TERLAMBAT";

export interface SchedulePolicy {
  readonly openMinute: number;
  readonly startMinute: number;
  readonly lateToleranceMinutes: number;
  readonly closeMinute: number;
}

export interface GeofencePolicy extends GeoPoint {
  readonly radiusM: number;
}

export interface LocationFix extends GeoPoint {
  /** Radius akurasi (meter); null = tidak dikirim klien (ditolak). */
  readonly accuracyM: number | null;
  /** Flag mock dari Expo; null = tidak diketahui (iOS/OS lama) -> diterima. */
  readonly mocked: boolean | null;
  /** Waktu fix menurut jam perangkat (epoch ms). */
  readonly locationTimestampMs: number;
  /** Waktu kirim menurut jam perangkat (epoch ms). */
  readonly clientTimeMs: number;
}

export interface DayStatus {
  readonly isSchoolDay: boolean;
  readonly reason: DayReason;
  readonly holidayName: string | null;
}

export const LOCATION_REJECT_CODES = ["INVALID_LOCATION", "MOCK_LOCATION", "LOCATION_STALE", "GPS_ACCURACY_TOO_LOW", "OUTSIDE_GEOFENCE"] as const;
export type LocationRejectCode = (typeof LOCATION_REJECT_CODES)[number];

export type CheckInRejection =
  | { readonly code: "NOT_SCHOOL_DAY"; readonly details: { readonly reason: DayReason; readonly holidayName: string | null } }
  | { readonly code: "CHECKIN_NOT_OPEN"; readonly details: { readonly opensAt: string } }
  | { readonly code: "CHECKIN_CLOSED"; readonly details: { readonly closedAt: string } }
  | { readonly code: "INVALID_LOCATION"; readonly details: null }
  | { readonly code: "MOCK_LOCATION"; readonly details: null }
  | { readonly code: "LOCATION_STALE"; readonly details: { readonly fixAgeS: number; readonly maxFixAgeS: number } }
  | { readonly code: "GPS_ACCURACY_TOO_LOW"; readonly details: { readonly accuracyM: number | null; readonly maxAccuracyM: number } }
  | { readonly code: "OUTSIDE_GEOFENCE"; readonly details: { readonly distanceM: number; readonly radiusM: number } };

export type CheckInRejectCode = CheckInRejection["code"];

export type LocationResult =
  | { readonly ok: true; readonly distanceM: number; readonly usedTolerance: boolean }
  | { readonly ok: false; readonly rejection: CheckInRejection };

export interface Lateness {
  readonly status: PresenceStatus;
  readonly lateMinutes: number | null;
}

export type CheckInDecision =
  | { readonly kind: "REPLAY" }
  | { readonly kind: "CONFLICT"; readonly source: "ADMIN" | "AUTO_ALPHA" }
  | { readonly kind: "REJECT"; readonly rejection: CheckInRejection }
  | {
      readonly kind: "ACCEPT";
      readonly mode: "CREATE" | "CONVERT_LEAVE";
      readonly status: PresenceStatus;
      readonly lateMinutes: number | null;
      /** Jarak dibulatkan ke meter. */
      readonly distanceM: number;
      /** Diterima hanya berkat toleransi akurasi (jarak > radius). */
      readonly usedTolerance: boolean;
    };

export interface CheckInDecisionInput {
  readonly existingSource: AttendanceSourceCode | null;
  readonly day: DayStatus;
  /** Menit lokal sekolah menurut jam SERVER. */
  readonly minuteOfDay: number;
  readonly schedule: SchedulePolicy;
  readonly geofence: GeofencePolicy;
  readonly fix: LocationFix;
}

/** Baris absensi (siswa, tanggal) yang sudah ada menentukan jalur check-in. */
export function classifyExisting(source: AttendanceSourceCode | null): CheckInMode {
  if (source === null) return "CREATE";
  if (source === "CHECKIN") return "REPLAY";
  if (source === "LEAVE") return "CONVERT_LEAVE";
  return "CONFLICT";
}

export function windowState(minuteOfDay: number, schedule: SchedulePolicy): WindowState {
  if (minuteOfDay < schedule.openMinute) return "BEFORE_OPEN";
  if (minuteOfDay >= schedule.closeMinute) return "CLOSED";
  return "OPEN";
}

/** TERLAMBAT bila menit lokal > mulai + toleransi; lateMinutes dihitung dari bel masuk (maks 720). */
export function computeLateness(minuteOfDay: number, schedule: SchedulePolicy): Lateness {
  if (minuteOfDay <= schedule.startMinute + schedule.lateToleranceMinutes) return { status: "HADIR", lateMinutes: null };
  return { status: "TERLAMBAT", lateMinutes: Math.min(MAX_LATE_MINUTES, minuteOfDay - schedule.startMinute) };
}

/** Umur fix menurut jam perangkat (detik); selisih jam perangkat vs server saling meniadakan. */
export function fixAgeSeconds(fix: LocationFix): number {
  return (fix.clientTimeMs - fix.locationTimestampMs) / 1000;
}

/** Jarak ke titik pusat sekolah (meter, dibulatkan); null untuk (0,0). */
export function distanceToSchool(fix: GeoPoint, geofence: GeoPoint): number | null {
  if (isNullIsland(fix)) return null;
  return Math.round(haversineMeters(fix, geofence));
}

function preGeofenceRejection(fix: LocationFix): CheckInRejection | null {
  if (isNullIsland(fix)) return { code: "INVALID_LOCATION", details: null };
  if (fix.mocked === true && BLOCK_MOCKED_LOCATION) return { code: "MOCK_LOCATION", details: null };
  const age = fixAgeSeconds(fix);
  if (age > FIX_AGE_REJECT_S) return { code: "LOCATION_STALE", details: { fixAgeS: Math.round(age), maxFixAgeS: FIX_AGE_REJECT_S } };
  if (fix.accuracyM === null || fix.accuracyM > MAX_ACCEPTED_ACCURACY_M) {
    return { code: "GPS_ACCURACY_TOO_LOW", details: { accuracyM: fix.accuracyM === null ? null : Math.round(fix.accuracyM), maxAccuracyM: MAX_ACCEPTED_ACCURACY_M } };
  }
  return null;
}

export function evaluateLocation(fix: LocationFix, geofence: GeofencePolicy): LocationResult {
  const rejection = preGeofenceRejection(fix);
  if (rejection) return { ok: false, rejection };
  const distance = haversineMeters(fix, geofence);
  const tolerance = Math.min(fix.accuracyM ?? 0, ACCURACY_TOLERANCE_CAP_M);
  if (distance > geofence.radiusM + tolerance) {
    return { ok: false, rejection: { code: "OUTSIDE_GEOFENCE", details: { distanceM: Math.round(distance), radiusM: geofence.radiusM } } };
  }
  return { ok: true, distanceM: Math.round(distance), usedTolerance: distance > geofence.radiusM };
}

function calendarRejection(day: DayStatus, minuteOfDay: number, schedule: SchedulePolicy): CheckInRejection | null {
  if (!day.isSchoolDay) return { code: "NOT_SCHOOL_DAY", details: { reason: day.reason, holidayName: day.holidayName } };
  const state = windowState(minuteOfDay, schedule);
  if (state === "BEFORE_OPEN") return { code: "CHECKIN_NOT_OPEN", details: { opensAt: formatMinute(schedule.openMinute) } };
  if (state === "CLOSED") return { code: "CHECKIN_CLOSED", details: { closedAt: formatMinute(schedule.closeMinute) } };
  return null;
}

export function decideCheckIn(input: CheckInDecisionInput): CheckInDecision {
  const mode = classifyExisting(input.existingSource);
  if (mode === "REPLAY") return { kind: "REPLAY" };
  if (mode === "CONFLICT") return { kind: "CONFLICT", source: input.existingSource === "ADMIN" ? "ADMIN" : "AUTO_ALPHA" };
  const calendar = calendarRejection(input.day, input.minuteOfDay, input.schedule);
  if (calendar) return { kind: "REJECT", rejection: calendar };
  const location = evaluateLocation(input.fix, input.geofence);
  if (!location.ok) return { kind: "REJECT", rejection: location.rejection };
  const lateness = computeLateness(input.minuteOfDay, input.schedule);
  return { kind: "ACCEPT", mode, ...lateness, distanceM: location.distanceM, usedTolerance: location.usedTolerance };
}

export type BlockReason = "ALREADY_CHECKED_IN" | "ATTENDANCE_ALREADY_RECORDED" | "NOT_SCHOOL_DAY" | "CHECKIN_NOT_OPEN" | "CHECKIN_CLOSED";

/** Alasan tombol check-in dinonaktifkan di layar "hari ini" (null = boleh check-in). */
export function todayBlockReason(input: { existingSource: AttendanceSourceCode | null; day: DayStatus; window: WindowState }): BlockReason | null {
  const mode = classifyExisting(input.existingSource);
  if (mode === "REPLAY") return "ALREADY_CHECKED_IN";
  if (mode === "CONFLICT") return "ATTENDANCE_ALREADY_RECORDED";
  if (!input.day.isSchoolDay) return "NOT_SCHOOL_DAY";
  if (input.window === "BEFORE_OPEN") return "CHECKIN_NOT_OPEN";
  if (input.window === "CLOSED") return "CHECKIN_CLOSED";
  return null;
}

/** Alasan lokasi dicatat sebagai CheckInRejection (nama sama dengan enum CheckInRejectReason). */
export function isLocationRejection(code: CheckInRejectCode): code is LocationRejectCode {
  return (LOCATION_REJECT_CODES as readonly string[]).includes(code);
}

export interface RejectionLocation {
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly accuracyM: number | null;
  readonly distanceM: number | null;
}

/**
 * Lokasi yang boleh disimpan untuk percobaan ditolak (privasi anak): koordinat dibulatkan 3 desimal
 * (~100 m) dan dibuang seluruhnya bila jarak > 2 km atau lokasi (0,0) (distanceM null).
 */
export function rejectionLocation(fix: GeoPoint & { readonly accuracyM: number | null }, distanceM: number | null): RejectionLocation {
  const keepCoords = distanceM !== null && distanceM <= REJECTION_COORD_MAX_DISTANCE_M;
  return {
    latitude: keepCoords ? roundCoord(fix.latitude, REJECTION_COORD_DECIMALS) : null,
    longitude: keepCoords ? roundCoord(fix.longitude, REJECTION_COORD_DECIMALS) : null,
    accuracyM: fix.accuracyM === null ? null : Math.round(fix.accuracyM),
    distanceM,
  };
}

const NON_SCHOOL_DAY_MESSAGES: Readonly<Record<DayReason, string>> = {
  SCHOOL_DAY: "Hari ini hari sekolah.",
  DAY_OFF: "Hari ini bukan hari sekolah. Tidak ada absensi.",
  OUTSIDE_TERM: "Hari ini di luar masa semester. Tidak ada absensi.",
  HOLIDAY: "Hari ini libur. Tidak ada absensi.",
};

/** Pesan penolakan untuk ditampilkan apa adanya oleh aplikasi siswa. */
export function rejectMessage(rejection: CheckInRejection): string {
  switch (rejection.code) {
    case "NOT_SCHOOL_DAY": {
      const { reason, holidayName } = rejection.details;
      return reason === "HOLIDAY" && holidayName ? `Hari ini libur: ${holidayName}. Tidak ada absensi.` : NON_SCHOOL_DAY_MESSAGES[reason];
    }
    case "CHECKIN_NOT_OPEN":
      return `Absensi belum dibuka. Absensi dibuka pukul ${rejection.details.opensAt}.`;
    case "CHECKIN_CLOSED":
      return `Absensi hari ini sudah ditutup pukul ${rejection.details.closedAt}.`;
    case "INVALID_LOCATION":
      return "Lokasi tidak valid. Aktifkan GPS lalu coba lagi.";
    case "MOCK_LOCATION":
      return "Lokasi palsu (mock location) terdeteksi. Matikan aplikasi pemalsu lokasi lalu coba lagi.";
    case "LOCATION_STALE":
      return `Data lokasi sudah kedaluwarsa (diambil ${rejection.details.fixAgeS} detik lalu, maksimal ${rejection.details.maxFixAgeS} detik). Perbarui lokasi lalu coba lagi.`;
    case "GPS_ACCURACY_TOO_LOW": {
      const { accuracyM, maxAccuracyM } = rejection.details;
      if (accuracyM === null) return "Akurasi GPS tidak terbaca. Aktifkan GPS akurasi tinggi lalu coba lagi.";
      return `Akurasi GPS terlalu rendah (±${accuracyM} m, maksimal ${maxAccuracyM} m). Pindah ke area terbuka lalu coba lagi.`;
    }
    case "OUTSIDE_GEOFENCE":
      return `Anda berada ${rejection.details.distanceM} m dari sekolah (batas ${rejection.details.radiusM} m).`;
  }
}
