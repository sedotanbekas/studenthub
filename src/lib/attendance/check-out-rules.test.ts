import { test } from "node:test";
import assert from "node:assert/strict";
import type { GeofencePolicy, LocationFix } from "./check-in-rules";
import {
  CHECK_OUT_BLOCK_REASONS,
  checkOutBlockReason,
  checkOutMessage,
  checkOutRejectMessage,
  checkOutWindowState,
  decideCheckOut,
  isCheckedIn,
  type CheckOutDecisionInput,
  type CheckOutRecordState,
} from "./check-out-rules";

/** Sekolah di khatulistiwa: 0,001° lintang ~111,2 m (sama dengan check-in-rules.test.ts). */
const SCHOOL: GeofencePolicy = { latitude: 0.5, longitude: 100, radiusM: 150 };
const NOW = Date.UTC(2091, 2, 5, 8, 0, 0);
const M_PER_DEG = 111_195.1;
/** Absen pulang dibuka 14:00. */
const OPEN = 840;
const SCHOOL_DAY = { isSchoolDay: true, reason: "SCHOOL_DAY", holidayName: null } as const;
const HOLIDAY = { isSchoolDay: false, reason: "HOLIDAY", holidayName: "Libur Uji" } as const;
const PRESENT: CheckOutRecordState = { status: "HADIR", checkedIn: true, checkOutTimeLocal: null };

function fixAt(meters: number, overrides: Partial<LocationFix> = {}): LocationFix {
  return {
    latitude: SCHOOL.latitude + meters / M_PER_DEG,
    longitude: SCHOOL.longitude,
    accuracyM: 10,
    mocked: false,
    locationTimestampMs: NOW - 5_000,
    clientTimeMs: NOW,
    ...overrides,
  };
}

function input(overrides: Partial<CheckOutDecisionInput> = {}): CheckOutDecisionInput {
  return { record: PRESENT, day: SCHOOL_DAY, minuteOfDay: 900, openMinute: OPEN, geofence: SCHOOL, fix: fixAt(20), testMode: false, ...overrides };
}

const blockOf = (overrides: Partial<CheckOutDecisionInput> = {}) => {
  const i = input(overrides);
  return checkOutBlockReason({ record: i.record, day: i.day, minuteOfDay: i.minuteOfDay, openMinute: i.openMinute, testMode: i.testMode });
};

test("isCheckedIn: hanya baris yang sudah absen masuk (checkInAt terisi) dan berstatus HADIR/TERLAMBAT", () => {
  const at = new Date(NOW);
  assert.equal(isCheckedIn({ status: "HADIR", checkInAt: at }), true);
  assert.equal(isCheckedIn({ status: "TERLAMBAT", checkInAt: at }), true);
  assert.equal(isCheckedIn({ status: "HADIR", checkInAt: null }), false, "catatan admin tanpa absen masuk");
  assert.equal(isCheckedIn({ status: "ALPHA", checkInAt: at }), false, "dikoreksi menjadi Alpa");
  assert.equal(isCheckedIn({ status: "IZIN", checkInAt: null }), false);
});

test("jendela absen pulang: sebelum jam buka BEFORE_OPEN, mulai jam buka sampai akhir hari OPEN", () => {
  assert.equal(checkOutWindowState(839, OPEN), "BEFORE_OPEN");
  assert.equal(checkOutWindowState(840, OPEN), "OPEN");
  assert.equal(checkOutWindowState(1439, OPEN), "OPEN");
});

test("blockReason: urutan belum masuk -> sudah pulang -> hari sekolah -> jam buka", () => {
  assert.equal(blockOf(), null);
  assert.equal(blockOf({ record: null }), "NOT_CHECKED_IN");
  assert.equal(blockOf({ record: { status: "ALPHA", checkedIn: false, checkOutTimeLocal: null } }), "NOT_CHECKED_IN");
  assert.equal(blockOf({ record: { ...PRESENT, checkOutTimeLocal: "14:05" } }), "ALREADY_CHECKED_OUT");
  assert.equal(blockOf({ record: null, day: HOLIDAY }), "NOT_CHECKED_IN", "belum masuk lebih dulu daripada hari libur");
  assert.equal(blockOf({ day: HOLIDAY }), "NOT_SCHOOL_DAY");
  assert.equal(blockOf({ minuteOfDay: 839 }), "CHECKOUT_NOT_OPEN");
  assert.equal(blockOf({ minuteOfDay: 840 }), null);
  assert.deepEqual([...CHECK_OUT_BLOCK_REASONS].sort(), ["ALREADY_CHECKED_OUT", "CHECKOUT_NOT_OPEN", "NOT_CHECKED_IN", "NOT_SCHOOL_DAY"]);
});

test("mode uji: hari & jam tidak menghalangi, tetapi belum masuk / sudah pulang tetap menghalangi", () => {
  assert.equal(blockOf({ testMode: true, day: HOLIDAY, minuteOfDay: 400 }), null);
  assert.equal(blockOf({ testMode: true, record: null }), "NOT_CHECKED_IN");
  assert.equal(blockOf({ testMode: true, record: { ...PRESENT, checkOutTimeLocal: "15:00" } }), "ALREADY_CHECKED_OUT");
});

test("decideCheckOut: diterima di dalam area setelah jam buka (jarak dibulatkan)", () => {
  const decision = decideCheckOut(input());
  assert.deepEqual(decision, { kind: "ACCEPT", distanceM: 20, testModeBypass: false });
});

test("decideCheckOut: penolakan kalender/catatan membawa detail untuk aplikasi", () => {
  assert.deepEqual(decideCheckOut(input({ record: null })), { kind: "REJECT", rejection: { code: "NOT_CHECKED_IN", details: null } });
  assert.deepEqual(decideCheckOut(input({ record: { ...PRESENT, checkOutTimeLocal: "14:10" } })), {
    kind: "REJECT",
    rejection: { code: "ALREADY_CHECKED_OUT", details: { checkOutTimeLocal: "14:10" } },
  });
  assert.deepEqual(decideCheckOut(input({ minuteOfDay: 800 })), { kind: "REJECT", rejection: { code: "CHECKOUT_NOT_OPEN", details: { opensAt: "14:00" } } });
  assert.deepEqual(decideCheckOut(input({ day: HOLIDAY })), {
    kind: "REJECT",
    rejection: { code: "NOT_SCHOOL_DAY", details: { reason: "HOLIDAY", holidayName: "Libur Uji" } },
  });
});

test("decideCheckOut: validasi lokasi sama dengan check-in (geofence, mock, basi, akurasi, (0,0))", () => {
  const codeOf = (fix: LocationFix) => {
    const decision = decideCheckOut(input({ fix }));
    return decision.kind === "REJECT" ? decision.rejection.code : decision.kind;
  };
  assert.equal(codeOf(fixAt(400)), "OUTSIDE_GEOFENCE");
  assert.equal(codeOf(fixAt(20, { mocked: true })), "MOCK_LOCATION");
  assert.equal(codeOf(fixAt(20, { locationTimestampMs: NOW - 200_000 })), "LOCATION_STALE");
  assert.equal(codeOf(fixAt(20, { accuracyM: 150 })), "GPS_ACCURACY_TOO_LOW");
  assert.equal(codeOf({ ...fixAt(0), latitude: 0, longitude: 0 }), "INVALID_LOCATION");
  assert.equal(codeOf(fixAt(160, { accuracyM: 20 })), "ACCEPT", "toleransi akurasi sama dengan check-in");
});

test("decideCheckOut mode uji: di luar area/jam tetap diterima (testModeBypass), lokasi palsu tetap ditolak", () => {
  assert.deepEqual(decideCheckOut(input({ testMode: true, minuteOfDay: 500, fix: fixAt(5_000) })), { kind: "ACCEPT", distanceM: 5_000, testModeBypass: true });
  assert.deepEqual(decideCheckOut(input({ testMode: true })), { kind: "ACCEPT", distanceM: 20, testModeBypass: false });
  const mocked = decideCheckOut(input({ testMode: true, fix: fixAt(20, { mocked: true }) }));
  assert.equal(mocked.kind === "REJECT" && mocked.rejection.code, "MOCK_LOCATION");
});

test("pesan penolakan & sukses berbahasa Indonesia", () => {
  assert.equal(checkOutRejectMessage({ code: "NOT_CHECKED_IN", details: null }), "Anda belum absen masuk hari ini, jadi absen pulang belum bisa dilakukan.");
  assert.equal(checkOutRejectMessage({ code: "ALREADY_CHECKED_OUT", details: { checkOutTimeLocal: "14:10" } }), "Anda sudah absen pulang hari ini pukul 14:10.");
  assert.equal(checkOutRejectMessage({ code: "CHECKOUT_NOT_OPEN", details: { opensAt: "14:00" } }), "Absen pulang belum dibuka. Absen pulang dibuka pukul 14:00.");
  assert.equal(checkOutRejectMessage({ code: "OUTSIDE_GEOFENCE", details: { distanceM: 412, radiusM: 150 } }), "Anda berada 412 m dari sekolah (batas 150 m).");
  assert.equal(checkOutRejectMessage({ code: "NOT_SCHOOL_DAY", details: { reason: "HOLIDAY", holidayName: "Libur Uji" } }), "Hari ini libur: Libur Uji. Tidak ada absensi.");
  assert.equal(checkOutMessage("14:32"), "Absen pulang berhasil. Anda tercatat pulang pukul 14:32.");
});
