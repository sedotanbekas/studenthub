import { hammingDistance, NEAR_DUPLICATE_MAX_DISTANCE } from "@/lib/storage/phash";
import {
  CLOCK_SKEW_FLAG_S,
  FIX_AGE_FLAG_S,
  FIX_FUTURE_TOLERANCE_S,
  LOW_ACCURACY_FLAG_M,
  NEW_DEVICE_WINDOW_DAYS,
  SUSPICIOUS_ACCURACY_M,
} from "./constants";

/**
 * Flag anomali check-in v1 (murni). Anomali TIDAK PERNAH memblokir check-in dan tidak pernah
 * dikirim ke siswa. Disimpan di Attendance.anomalyFlags sebagai array kode unik (check-in menulis
 * terurut; sapuan SHARED_DEVICE di sweep.ts menambahkan di ujung), jadi pembaca WAJIB lewat parseFlags;
 * hasAnomaly = ada flag MEDIUM/HIGH (flag LOW hanya konteks bagi admin).
 */
export const ANOMALY_CODES = [
  "CLOCK_SKEW",
  "DEVICE_SESSION_MISMATCH",
  "DUPLICATE_SELFIE",
  "GEOFENCE_TOLERANCE",
  "LOW_ACCURACY",
  "NEW_DEVICE",
  "PERFECT_ACCURACY",
  "SHARED_DEVICE",
  "STALE_FIX",
  "TIME_INCONSISTENT",
] as const;
export type AnomalyCode = (typeof ANOMALY_CODES)[number];
export type AnomalySeverity = "LOW" | "MEDIUM" | "HIGH";

export const ANOMALY_SEVERITY: Readonly<Record<AnomalyCode, AnomalySeverity>> = Object.freeze({
  CLOCK_SKEW: "LOW",
  DEVICE_SESSION_MISMATCH: "MEDIUM",
  DUPLICATE_SELFIE: "HIGH",
  GEOFENCE_TOLERANCE: "LOW",
  LOW_ACCURACY: "LOW",
  NEW_DEVICE: "MEDIUM",
  PERFECT_ACCURACY: "MEDIUM",
  SHARED_DEVICE: "HIGH",
  STALE_FIX: "LOW",
  TIME_INCONSISTENT: "MEDIUM",
});

export const ANOMALY_LABELS: Readonly<Record<AnomalyCode, string>> = Object.freeze({
  CLOCK_SKEW: "Jam perangkat berbeda jauh dari jam server",
  DEVICE_SESSION_MISMATCH: "Perangkat berbeda dengan perangkat saat login",
  DUPLICATE_SELFIE: "Selfie sangat mirip dengan selfie sebelumnya",
  GEOFENCE_TOLERANCE: "Di luar radius, diterima karena toleransi akurasi GPS",
  LOW_ACCURACY: "Akurasi GPS rendah",
  NEW_DEVICE: "Perangkat baru (berganti dalam 7 hari terakhir)",
  PERFECT_ACCURACY: "Akurasi GPS terlalu sempurna (indikasi lokasi palsu)",
  SHARED_DEVICE: "Perangkat yang sama dipakai siswa lain hari ini",
  STALE_FIX: "Data lokasi agak lama",
  TIME_INCONSISTENT: "Waktu lokasi lebih baru dari waktu kirim",
});

export interface AnomalyInput {
  /** Jam server (epoch ms). */
  readonly nowMs: number;
  readonly distanceM: number;
  readonly radiusM: number;
  readonly accuracyM: number;
  readonly locationTimestampMs: number;
  readonly clientTimeMs: number;
  readonly requestDeviceId: string;
  /** AuthSession.deviceId; null = sesi tanpa perangkat (tidak ada flag). */
  readonly sessionDeviceId: string | null;
  /** Student.deviceBoundAt (diisi login saat perangkat terikat berganti). */
  readonly deviceBoundAtMs: number | null;
  /** deviceId check-in terakhir SEBELUM pengikatan itu; null = pengikatan pertama (bukan perangkat baru). */
  readonly deviceBeforeBinding: string | null;
  readonly selfiePhash: string | null;
  /** dHash selfie siswa ini dalam 60 hari terakhir. */
  readonly recentSelfiePhashes: readonly string[];
  /** Siswa lain di sekolah yang sama sudah check-in hari ini dengan deviceId yang sama. */
  readonly sharedDevice: boolean;
}

const DAY_MS = 86_400_000;
const isAnomalyCode = (value: unknown): value is AnomalyCode => typeof value === "string" && (ANOMALY_CODES as readonly string[]).includes(value);

/** Array kode terurut unik (bentuk simpan anomalyFlags). */
export function normalizeFlags(codes: readonly AnomalyCode[]): AnomalyCode[] {
  return [...new Set(codes)].sort();
}

/** Baca anomalyFlags dari DB secara toleran (null/sampah/kode tak dikenal diabaikan). */
export function parseFlags(json: unknown): AnomalyCode[] {
  if (!Array.isArray(json)) return [];
  return normalizeFlags(json.filter(isAnomalyCode));
}

/** Gabungan flag lama (JSON apa pun) + tambahan, tanpa memutasi masukan. */
export function mergeFlags(existing: unknown, added: readonly AnomalyCode[]): AnomalyCode[] {
  return normalizeFlags([...parseFlags(existing), ...added]);
}

export function hasReportableAnomaly(flags: readonly AnomalyCode[]): boolean {
  return flags.some((code) => ANOMALY_SEVERITY[code] !== "LOW");
}

/** Selfie mirip (dHash hamming <= NEAR_DUPLICATE_MAX_DISTANCE) dengan salah satu kandidat. */
export function isDuplicateSelfie(phash: string | null, candidates: readonly string[]): boolean {
  if (phash === null) return false;
  return candidates.some((other) => hammingDistance(phash, other) <= NEAR_DUPLICATE_MAX_DISTANCE);
}

function isNewDevice(input: AnomalyInput): boolean {
  if (input.deviceBoundAtMs === null || input.deviceBeforeBinding === null) return false;
  const withinWindow = input.nowMs - input.deviceBoundAtMs <= NEW_DEVICE_WINDOW_DAYS * DAY_MS;
  return withinWindow && input.deviceBeforeBinding !== input.requestDeviceId;
}

function locationFlags(input: AnomalyInput): AnomalyCode[] {
  const fixAgeS = (input.clientTimeMs - input.locationTimestampMs) / 1000;
  const checks: ReadonlyArray<readonly [AnomalyCode, boolean]> = [
    ["GEOFENCE_TOLERANCE", input.distanceM > input.radiusM],
    ["LOW_ACCURACY", input.accuracyM > LOW_ACCURACY_FLAG_M],
    ["PERFECT_ACCURACY", input.accuracyM <= SUSPICIOUS_ACCURACY_M],
    ["STALE_FIX", fixAgeS > FIX_AGE_FLAG_S],
    ["TIME_INCONSISTENT", fixAgeS < -FIX_FUTURE_TOLERANCE_S],
    ["CLOCK_SKEW", Math.abs(input.clientTimeMs - input.nowMs) > CLOCK_SKEW_FLAG_S * 1000],
  ];
  return checks.filter(([, hit]) => hit).map(([code]) => code);
}

function identityFlags(input: AnomalyInput): AnomalyCode[] {
  const checks: ReadonlyArray<readonly [AnomalyCode, boolean]> = [
    ["DEVICE_SESSION_MISMATCH", input.sessionDeviceId !== null && input.sessionDeviceId !== input.requestDeviceId],
    ["NEW_DEVICE", isNewDevice(input)],
    ["DUPLICATE_SELFIE", isDuplicateSelfie(input.selfiePhash, input.recentSelfiePhashes)],
    ["SHARED_DEVICE", input.sharedDevice],
  ];
  return checks.filter(([, hit]) => hit).map(([code]) => code);
}

export function detectAnomalies(input: AnomalyInput): AnomalyCode[] {
  return normalizeFlags([...locationFlags(input), ...identityFlags(input)]);
}
