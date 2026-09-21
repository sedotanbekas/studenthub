import { formatMinute, type SchoolTz } from "@/lib/time/zone";

/**
 * Aturan murni konfigurasi sekolah (tanpa Prisma). `validateSchoolConfig` mencerminkan PERSIS
 * CHECK constraint School di migrasi init (chk_school_schedule/radius/tolerance/days/bank) plus
 * aturan aplikasi: koordinat dalam wilayah Indonesia, NPSN 8 digit, nomor rekening 5..30 digit.
 * Dipakai juga oleh domain lain (mis. absensi) sebagai satu-satunya validator konfigurasi sekolah.
 */
export const GEOFENCE_RADIUS_MIN_M = 50;
export const GEOFENCE_RADIUS_MAX_M = 1000;
export const LATE_TOLERANCE_MAX_MIN = 120;
export const MINUTES_PER_DAY = 1440;
export const SCHOOL_DAYS_MASK_MIN = 1;
export const SCHOOL_DAYS_MASK_MAX = 127;
export const INDONESIA_BOUNDS = { latMin: -11.5, latMax: 6.5, lngMin: 94.5, lngMax: 141.5 } as const;
export const NPSN_PATTERN = /^\d{8}$/;
export const BANK_ACCOUNT_NUMBER_PATTERN = /^\d{5,30}$/;
/** Presisi kolom Decimal(10,7). */
const COORDINATE_SCALE = 1e7;

export const SCHOOL_TIMEZONES = ["WIB", "WITA", "WIT"] as const satisfies readonly SchoolTz[];

/** Nilai default kolom School di skema Prisma. */
export const DEFAULT_SCHOOL_CONFIG = {
  geofenceRadiusM: 150,
  checkInOpenMinute: 360,
  startMinute: 420,
  lateToleranceMinutes: 15,
  checkInCloseMinute: 600,
  dayEndMinute: 900,
  schoolDaysMask: 31,
  bankName: null,
  bankAccountNumber: null,
  bankAccountHolder: null,
} as const;

export interface SchoolConfig {
  readonly npsn: string | null;
  readonly latitude: number;
  readonly longitude: number;
  readonly geofenceRadiusM: number;
  readonly timezone: SchoolTz;
  readonly checkInOpenMinute: number;
  readonly startMinute: number;
  readonly lateToleranceMinutes: number;
  readonly checkInCloseMinute: number;
  readonly dayEndMinute: number;
  readonly schoolDaysMask: number;
  readonly bankName: string | null;
  readonly bankAccountNumber: string | null;
  readonly bankAccountHolder: string | null;
}

/** Semua kolom School yang bisa diubah (konfigurasi + identitas). */
export interface SchoolSnapshot extends SchoolConfig {
  readonly name: string;
  readonly address: string | null;
  readonly provinceCode: string;
  readonly cityCode: string;
}

export type SchoolConfigField = keyof SchoolConfig;
export type SchoolField = keyof SchoolSnapshot;

export interface SchoolConfigError {
  readonly field: SchoolConfigField;
  readonly code: string;
  readonly message: string;
}

const INTEGER_FIELDS = [
  "geofenceRadiusM",
  "checkInOpenMinute",
  "startMinute",
  "lateToleranceMinutes",
  "checkInCloseMinute",
  "dayEndMinute",
  "schoolDaysMask",
] as const satisfies readonly SchoolConfigField[];

const BANK_FIELDS = ["bankName", "bankAccountNumber", "bankAccountHolder"] as const satisfies readonly SchoolConfigField[];

const err = (field: SchoolConfigField, code: string, message: string): SchoolConfigError => ({ field, code, message });

function integerErrors(c: SchoolConfig): SchoolConfigError[] {
  return INTEGER_FIELDS.filter((field) => !Number.isInteger(c[field])).map((field) =>
    err(field, "NOT_INTEGER", `${field} harus bilangan bulat.`),
  );
}

function scheduleErrors(c: SchoolConfig): SchoolConfigError[] {
  const errors: SchoolConfigError[] = [];
  if (c.checkInOpenMinute < 0) errors.push(err("checkInOpenMinute", "SCHEDULE_OPEN_NEGATIVE", "Jam buka absensi tidak boleh negatif."));
  if (c.checkInOpenMinute >= c.startMinute) {
    errors.push(err("checkInOpenMinute", "SCHEDULE_OPEN_NOT_BEFORE_START", "Jam buka absensi harus sebelum jam masuk."));
  }
  if (c.startMinute > c.checkInCloseMinute) {
    errors.push(err("checkInCloseMinute", "SCHEDULE_START_AFTER_CLOSE", "Jam tutup absensi tidak boleh sebelum jam masuk."));
  }
  if (c.checkInCloseMinute > c.dayEndMinute) {
    errors.push(err("dayEndMinute", "SCHEDULE_CLOSE_AFTER_DAY_END", "Akhir hari sekolah tidak boleh sebelum jam tutup absensi."));
  }
  if (c.dayEndMinute >= MINUTES_PER_DAY) {
    errors.push(err("dayEndMinute", "SCHEDULE_DAY_END_TOO_LATE", "Akhir hari sekolah harus sebelum pukul 24:00."));
  }
  if (c.lateToleranceMinutes < 0 || c.lateToleranceMinutes > LATE_TOLERANCE_MAX_MIN) {
    errors.push(err("lateToleranceMinutes", "LATE_TOLERANCE_OUT_OF_RANGE", `Toleransi terlambat harus 0 sampai ${LATE_TOLERANCE_MAX_MIN} menit.`));
  }
  if (c.startMinute + c.lateToleranceMinutes >= c.checkInCloseMinute) {
    errors.push(err("lateToleranceMinutes", "LATE_THRESHOLD_NOT_BEFORE_CLOSE", "Jam masuk + toleransi terlambat harus sebelum jam tutup absensi."));
  }
  return errors;
}

const inRange = (value: number, min: number, max: number): boolean => Number.isFinite(value) && value >= min && value <= max;

function locationErrors(c: SchoolConfig): SchoolConfigError[] {
  const errors: SchoolConfigError[] = [];
  const b = INDONESIA_BOUNDS;
  if (!inRange(c.latitude, b.latMin, b.latMax)) {
    errors.push(err("latitude", "LATITUDE_OUT_OF_RANGE", `Lintang harus di wilayah Indonesia (${b.latMin} sampai ${b.latMax}).`));
  }
  if (!inRange(c.longitude, b.lngMin, b.lngMax)) {
    errors.push(err("longitude", "LONGITUDE_OUT_OF_RANGE", `Bujur harus di wilayah Indonesia (${b.lngMin} sampai ${b.lngMax}).`));
  }
  if (Number.isInteger(c.geofenceRadiusM) && !inRange(c.geofenceRadiusM, GEOFENCE_RADIUS_MIN_M, GEOFENCE_RADIUS_MAX_M)) {
    errors.push(err("geofenceRadiusM", "RADIUS_OUT_OF_RANGE", `Radius geofence harus ${GEOFENCE_RADIUS_MIN_M} sampai ${GEOFENCE_RADIUS_MAX_M} meter.`));
  }
  if (!(SCHOOL_TIMEZONES as readonly string[]).includes(c.timezone)) {
    errors.push(err("timezone", "TIMEZONE_INVALID", "Zona waktu harus WIB, WITA, atau WIT."));
  }
  return errors;
}

function identityErrors(c: SchoolConfig): SchoolConfigError[] {
  const errors: SchoolConfigError[] = [];
  if (c.npsn !== null && !NPSN_PATTERN.test(c.npsn)) errors.push(err("npsn", "NPSN_INVALID", "NPSN harus 8 digit angka."));
  if (Number.isInteger(c.schoolDaysMask) && !inRange(c.schoolDaysMask, SCHOOL_DAYS_MASK_MIN, SCHOOL_DAYS_MASK_MAX)) {
    errors.push(err("schoolDaysMask", "SCHOOL_DAYS_MASK_OUT_OF_RANGE", "Pilih minimal satu hari sekolah (mask 1 sampai 127)."));
  }
  return errors;
}

function bankErrors(c: SchoolConfig): SchoolConfigError[] {
  const blank = BANK_FIELDS.find((field) => c[field] !== null && (c[field] as string).trim() === "");
  if (blank) return [err(blank, "BANK_FIELD_BLANK", "Data rekening tidak boleh kosong; kirim null untuk menghapus rekening.")];
  const filled = BANK_FIELDS.filter((field) => c[field] !== null);
  if (filled.length > 0 && filled.length < BANK_FIELDS.length) {
    const missing = BANK_FIELDS.find((field) => c[field] === null) ?? "bankName";
    return [err(missing, "BANK_INCOMPLETE", "Nama bank, nomor rekening, dan nama pemilik rekening harus diisi semua atau dikosongkan semua.")];
  }
  if (c.bankAccountNumber !== null && !BANK_ACCOUNT_NUMBER_PATTERN.test(c.bankAccountNumber)) {
    return [err("bankAccountNumber", "BANK_ACCOUNT_NUMBER_INVALID", "Nomor rekening harus 5 sampai 30 digit angka.")];
  }
  return [];
}

/** Validasi konfigurasi LENGKAP (hasil merge). Kosong = valid. */
export function validateSchoolConfig(config: SchoolConfig): SchoolConfigError[] {
  return [...integerErrors(config), ...identityErrors(config), ...locationErrors(config), ...scheduleErrors(config), ...bankErrors(config)];
}

/** Gabungkan patch ke nilai sekarang: undefined = tetap, null = kosongkan. Tidak memutasi input. */
export function mergeSchoolPatch<T extends SchoolConfig>(current: T, patch: Readonly<Partial<T>>): T {
  const defined = Object.entries(patch).filter(([, value]) => value !== undefined);
  return { ...current, ...Object.fromEntries(defined) } as T;
}

/** Bulatkan koordinat ke presisi kolom Decimal(10,7). */
export function roundCoordinate(value: number): number {
  return Math.round(value * COORDINATE_SCALE) / COORDINATE_SCALE;
}

export type SchoolChangeGroup = "IDENTITY" | "REGION" | "LOCATION" | "TIMEZONE" | "SCHEDULE" | "SCHOOL_DAYS" | "BANK";

const FIELD_GROUPS: ReadonlyArray<readonly [SchoolField, SchoolChangeGroup]> = [
  ["name", "IDENTITY"],
  ["npsn", "IDENTITY"],
  ["address", "IDENTITY"],
  ["provinceCode", "REGION"],
  ["cityCode", "REGION"],
  ["latitude", "LOCATION"],
  ["longitude", "LOCATION"],
  ["geofenceRadiusM", "LOCATION"],
  ["timezone", "TIMEZONE"],
  ["checkInOpenMinute", "SCHEDULE"],
  ["startMinute", "SCHEDULE"],
  ["lateToleranceMinutes", "SCHEDULE"],
  ["checkInCloseMinute", "SCHEDULE"],
  ["dayEndMinute", "SCHEDULE"],
  ["schoolDaysMask", "SCHOOL_DAYS"],
  ["bankName", "BANK"],
  ["bankAccountNumber", "BANK"],
  ["bankAccountHolder", "BANK"],
];

const GROUP_ORDER: readonly SchoolChangeGroup[] = ["IDENTITY", "REGION", "LOCATION", "TIMEZONE", "SCHEDULE", "SCHOOL_DAYS", "BANK"];

function sameValue(field: SchoolField, a: unknown, b: unknown): boolean {
  if (field === "latitude" || field === "longitude") return roundCoordinate(a as number) === roundCoordinate(b as number);
  return a === b;
}

export interface SchoolChanges {
  readonly changedFields: SchoolField[];
  readonly groups: SchoolChangeGroup[];
  /** Lokasi/radius/zona waktu berubah -> School.geofenceUpdatedAt diisi. */
  readonly geofenceChanged: boolean;
  /** Salah satu kolom rekening berubah -> School.bankChangedAt diisi. */
  readonly bankChanged: boolean;
}

export function describeSchoolChanges<T extends SchoolSnapshot>(before: T, after: T): SchoolChanges {
  const changed = FIELD_GROUPS.filter(([field]) => !sameValue(field, before[field], after[field]));
  const groupSet = new Set(changed.map(([, group]) => group));
  const groups = GROUP_ORDER.filter((group) => groupSet.has(group));
  return {
    changedFields: changed.map(([field]) => field),
    groups,
    geofenceChanged: groupSet.has("LOCATION") || groupSet.has("TIMEZONE"),
    bankChanged: groupSet.has("BANK"),
  };
}

export type ScheduleLabels = { checkInOpen: string; start: string; lateAfter: string; checkInClose: string; dayEnd: string };

/** Menit lokal -> "HH:mm" untuk tampilan. lateAfter = batas akhir tepat waktu (mulai + toleransi). */
export function scheduleLabels(c: Pick<SchoolConfig, "checkInOpenMinute" | "startMinute" | "lateToleranceMinutes" | "checkInCloseMinute" | "dayEndMinute">): ScheduleLabels {
  return {
    checkInOpen: formatMinute(c.checkInOpenMinute),
    start: formatMinute(c.startMinute),
    lateAfter: formatMinute(c.startMinute + c.lateToleranceMinutes),
    checkInClose: formatMinute(c.checkInCloseMinute),
    dayEnd: formatMinute(c.dayEndMinute),
  };
}

export const DAY_CODES = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
export type DayCode = (typeof DAY_CODES)[number];

/** Bitmask Sen=1 ... Min=64 -> kode hari berurutan. */
export function schoolDayCodes(mask: number): DayCode[] {
  return DAY_CODES.filter((_, index) => (mask & (1 << index)) !== 0);
}
