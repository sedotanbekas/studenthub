import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DAY_END_AFTER_CLOSE_MIN,
  DEFAULT_SCHOOL_CONFIG,
  describeSchoolChanges,
  mergeSchoolPatch,
  roundCoordinate,
  schoolDayCodes,
  scheduleLabels,
  validateSchoolConfig,
  type SchoolConfig,
  type SchoolSnapshot,
} from "./rules";

const BASE: SchoolConfig = {
  ...DEFAULT_SCHOOL_CONFIG,
  npsn: null,
  latitude: -6.9147,
  longitude: 107.6098,
  timezone: "WIB",
};

const codes = (config: Partial<SchoolConfig>): string[] => validateSchoolConfig({ ...BASE, ...config }).map((e) => e.code);

test("konfigurasi default skema lolos validasi", () => {
  assert.deepEqual(validateSchoolConfig(BASE), []);
  assert.equal(DEFAULT_SCHOOL_CONFIG.geofenceRadiusM, 150);
  assert.equal(DEFAULT_SCHOOL_CONFIG.schoolDaysMask, 31);
});

test("urutan jadwal: 0 <= buka < mulai <= tutup, tutup + 5 menit <= akhir hari < 1440", () => {
  assert.deepEqual(codes({ checkInOpenMinute: 0 }), []);
  assert.deepEqual(codes({ checkInOpenMinute: -1 }), ["SCHEDULE_OPEN_NEGATIVE"]);
  assert.deepEqual(codes({ checkInOpenMinute: 419 }), []);
  assert.deepEqual(codes({ checkInOpenMinute: 420 }), ["SCHEDULE_OPEN_NOT_BEFORE_START"]);
  assert.equal(DAY_END_AFTER_CLOSE_MIN, 5);
  assert.deepEqual(codes({ checkInCloseMinute: 895 }), []);
  assert.deepEqual(codes({ checkInCloseMinute: 896 }), ["SCHEDULE_CLOSE_AFTER_DAY_END"], "check-in yang sedang berjalan harus selesai sebelum hari ditutup");
  assert.deepEqual(codes({ checkInCloseMinute: 900 }), ["SCHEDULE_CLOSE_AFTER_DAY_END"]);
  assert.deepEqual(codes({ dayEndMinute: 1439 }), []);
  assert.deepEqual(codes({ dayEndMinute: 1440 }), ["SCHEDULE_DAY_END_TOO_LATE"]);
  assert.ok(codes({ startMinute: 601 }).includes("SCHEDULE_START_AFTER_CLOSE"));
});

test("start + toleransi harus < tutup (mirip chk_school_schedule)", () => {
  assert.deepEqual(codes({ startMinute: 420, lateToleranceMinutes: 0, checkInCloseMinute: 421 }), []);
  assert.deepEqual(codes({ startMinute: 420, lateToleranceMinutes: 0, checkInCloseMinute: 420 }), ["LATE_THRESHOLD_NOT_BEFORE_CLOSE"]);
  assert.deepEqual(codes({ lateToleranceMinutes: 120 }), []);
  assert.deepEqual(codes({ lateToleranceMinutes: 180, checkInCloseMinute: 700 }), ["LATE_TOLERANCE_OUT_OF_RANGE"]);
  assert.deepEqual(codes({ lateToleranceMinutes: -1 }), ["LATE_TOLERANCE_OUT_OF_RANGE"]);
  assert.deepEqual(codes({ startMinute: 500, lateToleranceMinutes: 100 }), ["LATE_THRESHOLD_NOT_BEFORE_CLOSE"]);
});

test("radius geofence 50..1000", () => {
  assert.deepEqual(codes({ geofenceRadiusM: 49 }), ["RADIUS_OUT_OF_RANGE"]);
  assert.deepEqual(codes({ geofenceRadiusM: 50 }), []);
  assert.deepEqual(codes({ geofenceRadiusM: 1000 }), []);
  assert.deepEqual(codes({ geofenceRadiusM: 1001 }), ["RADIUS_OUT_OF_RANGE"]);
});

test("mask hari sekolah 1..127", () => {
  assert.deepEqual(codes({ schoolDaysMask: 0 }), ["SCHOOL_DAYS_MASK_OUT_OF_RANGE"]);
  assert.deepEqual(codes({ schoolDaysMask: 1 }), []);
  assert.deepEqual(codes({ schoolDaysMask: 127 }), []);
  assert.deepEqual(codes({ schoolDaysMask: 128 }), ["SCHOOL_DAYS_MASK_OUT_OF_RANGE"]);
});

test("angka pecahan pada kolom menit/radius ditolak", () => {
  assert.deepEqual(codes({ geofenceRadiusM: 150.5 }), ["NOT_INTEGER"]);
  assert.ok(codes({ startMinute: 420.5 }).includes("NOT_INTEGER"));
});

test("koordinat harus di wilayah Indonesia", () => {
  assert.deepEqual(codes({ latitude: -11.5, longitude: 94.5 }), []);
  assert.deepEqual(codes({ latitude: 6.5, longitude: 141.5 }), []);
  assert.deepEqual(codes({ latitude: -11.51 }), ["LATITUDE_OUT_OF_RANGE"]);
  assert.deepEqual(codes({ latitude: 6.51 }), ["LATITUDE_OUT_OF_RANGE"]);
  assert.deepEqual(codes({ longitude: 94.49 }), ["LONGITUDE_OUT_OF_RANGE"]);
  assert.deepEqual(codes({ longitude: 141.51 }), ["LONGITUDE_OUT_OF_RANGE"]);
  assert.deepEqual(codes({ latitude: Number.NaN }), ["LATITUDE_OUT_OF_RANGE"]);
});

test("NPSN opsional, 8 digit", () => {
  assert.deepEqual(codes({ npsn: "20219123" }), []);
  assert.deepEqual(codes({ npsn: "2021912" }), ["NPSN_INVALID"]);
  assert.deepEqual(codes({ npsn: "2021912a" }), ["NPSN_INVALID"]);
  assert.deepEqual(codes({ npsn: "202191234" }), ["NPSN_INVALID"]);
});

test("rekening: semua atau tidak sama sekali, nomor 5..30 digit", () => {
  const bank = { bankName: "BCA", bankAccountNumber: "1234567890", bankAccountHolder: "Yayasan Contoh" };
  assert.deepEqual(codes(bank), []);
  assert.deepEqual(codes({ bankName: null, bankAccountNumber: null, bankAccountHolder: null }), []);
  assert.deepEqual(codes({ ...bank, bankAccountHolder: null }), ["BANK_INCOMPLETE"]);
  assert.deepEqual(codes({ bankName: "BCA" }), ["BANK_INCOMPLETE"]);
  assert.deepEqual(codes({ ...bank, bankAccountNumber: "1234" }), ["BANK_ACCOUNT_NUMBER_INVALID"]);
  assert.deepEqual(codes({ ...bank, bankAccountNumber: "12345" }), []);
  assert.deepEqual(codes({ ...bank, bankAccountNumber: "1".repeat(30) }), []);
  assert.deepEqual(codes({ ...bank, bankAccountNumber: "1".repeat(31) }), ["BANK_ACCOUNT_NUMBER_INVALID"]);
  assert.deepEqual(codes({ ...bank, bankAccountNumber: "123-4567" }), ["BANK_ACCOUNT_NUMBER_INVALID"]);
  assert.deepEqual(codes({ ...bank, bankName: "  " }), ["BANK_FIELD_BLANK"]);
});

test("setiap galat memuat field dan pesan Bahasa Indonesia", () => {
  const [error] = validateSchoolConfig({ ...BASE, geofenceRadiusM: 10 });
  assert.equal(error?.field, "geofenceRadiusM");
  assert.match(error?.message ?? "", /radius/i);
});

test("mergeSchoolPatch: undefined dipertahankan, null mengosongkan, input tidak dimutasi", () => {
  const current: SchoolConfig = { ...BASE, bankName: "BCA", bankAccountNumber: "12345", bankAccountHolder: "X" };
  const frozen = Object.freeze({ ...current });
  const merged = mergeSchoolPatch(frozen, { startMinute: 430, bankName: null, checkInOpenMinute: undefined });
  assert.equal(merged.startMinute, 430);
  assert.equal(merged.bankName, null);
  assert.equal(merged.checkInOpenMinute, current.checkInOpenMinute);
  assert.equal(frozen.startMinute, 420);
  assert.notEqual(merged, frozen);
});

test("patch yang tidak valid setelah digabung terdeteksi", () => {
  const merged = mergeSchoolPatch(BASE, { checkInCloseMinute: 430 });
  assert.deepEqual(validateSchoolConfig(merged).map((e) => e.code), ["LATE_THRESHOLD_NOT_BEFORE_CLOSE"]);
});

test("roundCoordinate membulatkan ke 7 desimal (Decimal(10,7))", () => {
  assert.equal(roundCoordinate(-6.914700049), -6.9147);
  assert.equal(roundCoordinate(107.12345678), 107.1234568);
});

const SNAPSHOT: SchoolSnapshot = { ...BASE, name: "SMP Uji", address: null, provinceCode: "32", cityCode: "32.73" };

test("describeSchoolChanges: geofence, zona waktu, rekening, jadwal", () => {
  const none = describeSchoolChanges(SNAPSHOT, { ...SNAPSHOT });
  assert.deepEqual(none, { changedFields: [], groups: [], geofenceChanged: false, bankChanged: false });
  const geo = describeSchoolChanges(SNAPSHOT, { ...SNAPSHOT, latitude: -6.9, geofenceRadiusM: 200 });
  assert.deepEqual(geo.changedFields, ["latitude", "geofenceRadiusM"]);
  assert.deepEqual(geo.groups, ["LOCATION"]);
  assert.equal(geo.geofenceChanged, true);
  const tz = describeSchoolChanges(SNAPSHOT, { ...SNAPSHOT, timezone: "WITA" });
  assert.equal(tz.geofenceChanged, true);
  assert.deepEqual(tz.groups, ["TIMEZONE"]);
  const bank = describeSchoolChanges(SNAPSHOT, { ...SNAPSHOT, bankName: "BRI", bankAccountNumber: "99999", bankAccountHolder: "Y" });
  assert.equal(bank.bankChanged, true);
  assert.deepEqual(bank.groups, ["BANK"]);
  const mixed = describeSchoolChanges(SNAPSHOT, { ...SNAPSHOT, name: "SMP Baru", schoolDaysMask: 63, startMinute: 430, cityCode: "32.04" });
  assert.deepEqual(mixed.groups, ["IDENTITY", "REGION", "SCHEDULE", "SCHOOL_DAYS"]);
  assert.equal(mixed.geofenceChanged, false);
});

test("describeSchoolChanges mengabaikan selisih koordinat di bawah presisi DB", () => {
  const same = describeSchoolChanges(SNAPSHOT, { ...SNAPSHOT, latitude: -6.91470000001 });
  assert.deepEqual(same.changedFields, []);
});

test("label jadwal HH:mm dan kode hari sekolah", () => {
  assert.deepEqual(scheduleLabels(BASE), {
    checkInOpen: "06:00",
    start: "07:00",
    lateAfter: "07:15",
    checkInClose: "10:00",
    dayEnd: "15:00",
  });
  assert.deepEqual(schoolDayCodes(31), ["MON", "TUE", "WED", "THU", "FRI"]);
  assert.deepEqual(schoolDayCodes(64 + 1), ["MON", "SUN"]);
});
