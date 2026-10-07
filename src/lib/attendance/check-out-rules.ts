import type { DayReason } from "@/lib/calendar/rules";
import { formatMinute } from "@/lib/time/zone";
import { evaluateLocation, rejectMessage, type CheckInRejection, type DayStatus, type GeofencePolicy, type LocationFix } from "./check-in-rules";

/**
 * Keputusan absen pulang murni (permintaan pemilik 2026-10-07; tanpa Prisma, jam disuntikkan). Dipakai
 * POST check-out, precheck mode pulang, dan layar "hari ini" agar ketiganya selalu sepakat. Urutan (berhenti di
 * aturan pertama): sudah absen masuk (HADIR/TERLAMBAT dengan checkInAt) -> belum absen pulang -> hari sekolah ->
 * jam buka absen pulang (School.checkOutOpenMinute s.d. akhir hari) -> lokasi (sama PERSIS dengan check-in:
 * (0,0) -> mocked -> umur fix -> akurasi -> geofence) -> TERIMA. Selfie wajib (diperiksa skema multipart).
 *
 * Mode uji absensi (sementara, lihat test-mode.ts): hari sekolah, jam buka, dan geofence tidak menolak; syarat
 * sudah masuk / belum pulang serta pemeriksaan lokasi sebelum geofence tetap berlaku.
 */
export const CHECK_OUT_BLOCK_REASONS = ["NOT_CHECKED_IN", "ALREADY_CHECKED_OUT", "NOT_SCHOOL_DAY", "CHECKOUT_NOT_OPEN"] as const;
export type CheckOutBlockReason = (typeof CHECK_OUT_BLOCK_REASONS)[number];
export type CheckOutWindowState = "BEFORE_OPEN" | "OPEN";

type AttendanceStatusCode = "HADIR" | "TERLAMBAT" | "IZIN" | "SAKIT" | "ALPHA";

/** Ringkasan baris hari ini yang relevan untuk absen pulang. */
export interface CheckOutRecordState {
  readonly status: AttendanceStatusCode;
  /** Lihat isCheckedIn. */
  readonly checkedIn: boolean;
  /** Jam lokal absen pulang "HH:mm"; null = belum pulang. */
  readonly checkOutTimeLocal: string | null;
}

export type CheckOutRejection =
  | { readonly code: "NOT_CHECKED_IN"; readonly details: null }
  | { readonly code: "ALREADY_CHECKED_OUT"; readonly details: { readonly checkOutTimeLocal: string } }
  | { readonly code: "CHECKOUT_NOT_OPEN"; readonly details: { readonly opensAt: string } }
  | { readonly code: "NOT_SCHOOL_DAY"; readonly details: { readonly reason: DayReason; readonly holidayName: string | null } }
  | Extract<CheckInRejection, { code: "INVALID_LOCATION" | "MOCK_LOCATION" | "LOCATION_STALE" | "GPS_ACCURACY_TOO_LOW" | "OUTSIDE_GEOFENCE" }>;

export type CheckOutRejectCode = CheckOutRejection["code"];

export type CheckOutDecision =
  | { readonly kind: "REJECT"; readonly rejection: CheckOutRejection }
  | {
      readonly kind: "ACCEPT";
      /** Jarak ke titik sekolah dibulatkan ke meter. */
      readonly distanceM: number;
      /** Diterima hanya karena mode uji (di luar area, di luar jam, atau bukan hari sekolah). */
      readonly testModeBypass: boolean;
    };

export interface CheckOutStateInput {
  readonly record: CheckOutRecordState | null;
  readonly day: DayStatus;
  /** Menit lokal sekolah menurut jam SERVER. */
  readonly minuteOfDay: number;
  /** School.checkOutOpenMinute. */
  readonly openMinute: number;
  readonly testMode: boolean;
}

export interface CheckOutDecisionInput extends CheckOutStateInput {
  readonly geofence: GeofencePolicy;
  readonly fix: LocationFix;
}

/**
 * Sudah absen masuk: checkInAt terisi DAN status masih hadir (HADIR/TERLAMBAT). Catatan check-in yang dikoreksi
 * admin ke status hadir lain tetap boleh pulang; yang dikoreksi menjadi Izin/Sakit/Alpa atau dicatat admin tanpa
 * absen masuk tidak.
 */
export function isCheckedIn(row: { readonly status: AttendanceStatusCode; readonly checkInAt: Date | null }): boolean {
  return row.checkInAt !== null && (row.status === "HADIR" || row.status === "TERLAMBAT");
}

/** Absen pulang terbuka mulai jam buka sampai akhir hari lokal (23:59). */
export function checkOutWindowState(minuteOfDay: number, openMinute: number): CheckOutWindowState {
  return minuteOfDay < openMinute ? "BEFORE_OPEN" : "OPEN";
}

/** Penolakan sebelum lokasi diperiksa (catatan hari ini, hari sekolah, jam buka); null = lanjut ke lokasi. */
function stateRejection(input: CheckOutStateInput): { rejection: CheckOutRejection; bypassable: boolean } | null {
  const { record } = input;
  if (record === null || !record.checkedIn) return { rejection: { code: "NOT_CHECKED_IN", details: null }, bypassable: false };
  if (record.checkOutTimeLocal !== null) {
    return { rejection: { code: "ALREADY_CHECKED_OUT", details: { checkOutTimeLocal: record.checkOutTimeLocal } }, bypassable: false };
  }
  if (!input.day.isSchoolDay) {
    return { rejection: { code: "NOT_SCHOOL_DAY", details: { reason: input.day.reason, holidayName: input.day.holidayName } }, bypassable: true };
  }
  if (checkOutWindowState(input.minuteOfDay, input.openMinute) === "BEFORE_OPEN") {
    return { rejection: { code: "CHECKOUT_NOT_OPEN", details: { opensAt: formatMinute(input.openMinute) } }, bypassable: true };
  }
  return null;
}

/** Alasan tombol absen pulang dinonaktifkan di layar "hari ini" (null = boleh absen pulang). */
export function checkOutBlockReason(input: CheckOutStateInput): CheckOutBlockReason | null {
  const blocked = stateRejection(input);
  if (blocked === null || (blocked.bypassable && input.testMode)) return null;
  return blocked.rejection.code as CheckOutBlockReason;
}

export function decideCheckOut(input: CheckOutDecisionInput): CheckOutDecision {
  const blocked = stateRejection(input);
  if (blocked && !(blocked.bypassable && input.testMode)) return { kind: "REJECT", rejection: blocked.rejection };
  const location = evaluateLocation(input.fix, input.geofence, input.testMode);
  if (!location.ok) return { kind: "REJECT", rejection: location.rejection as CheckOutRejection };
  return { kind: "ACCEPT", distanceM: location.distanceM, testModeBypass: blocked !== null || location.outsideGeofence };
}

/** Pesan penolakan untuk ditampilkan apa adanya oleh aplikasi siswa. */
export function checkOutRejectMessage(rejection: CheckOutRejection): string {
  switch (rejection.code) {
    case "NOT_CHECKED_IN":
      return "Anda belum absen masuk hari ini, jadi absen pulang belum bisa dilakukan.";
    case "ALREADY_CHECKED_OUT":
      return `Anda sudah absen pulang hari ini pukul ${rejection.details.checkOutTimeLocal}.`;
    case "CHECKOUT_NOT_OPEN":
      return `Absen pulang belum dibuka. Absen pulang dibuka pukul ${rejection.details.opensAt}.`;
    default:
      return rejectMessage(rejection);
  }
}

/** Pesan sukses absen pulang. */
export function checkOutMessage(checkOutTimeLocal: string): string {
  return `Absen pulang berhasil. Anda tercatat pulang pukul ${checkOutTimeLocal}.`;
}
