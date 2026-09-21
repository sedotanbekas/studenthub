import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyExisting,
  computeLateness,
  decideCheckIn,
  distanceToSchool,
  evaluateLocation,
  fixAgeSeconds,
  isLocationRejection,
  rejectMessage,
  rejectionLocation,
  todayBlockReason,
  windowState,
  type CheckInDecisionInput,
  type GeofencePolicy,
  type LocationFix,
  type SchedulePolicy,
} from "./check-in-rules";

/** Jadwal default: buka 06:00, masuk 07:00, toleransi 15, tutup 10:00. */
const SCHEDULE: SchedulePolicy = { openMinute: 360, startMinute: 420, lateToleranceMinutes: 15, closeMinute: 600 };
/** Sekolah di khatulistiwa agar jarak mudah dihitung: 0,001° lintang ~111,2 m. */
const SCHOOL: GeofencePolicy = { latitude: 0.5, longitude: 100, radiusM: 150 };
const NOW = Date.UTC(2091, 2, 5, 0, 0, 0);
/** Sedikit di atas 2πR/360 (111.195,0802) agar jarak uji sedikit di bawah nilai nominal (aman dari galat float). */
const M_PER_DEG = 111_195.1;

/** Titik sejauh `meters` ke utara sekolah. */
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

const SCHOOL_DAY = { isSchoolDay: true, reason: "SCHOOL_DAY", holidayName: null } as const;

function input(overrides: Partial<CheckInDecisionInput> = {}): CheckInDecisionInput {
  return { existingSource: null, day: SCHOOL_DAY, minuteOfDay: 400, schedule: SCHEDULE, geofence: SCHOOL, fix: fixAt(20), ...overrides };
}

test("classifyExisting: tanpa baris CREATE, CHECKIN REPLAY, ADMIN/AUTO_ALPHA CONFLICT, LEAVE CONVERT", () => {
  assert.equal(classifyExisting(null), "CREATE");
  assert.equal(classifyExisting("CHECKIN"), "REPLAY");
  assert.equal(classifyExisting("ADMIN"), "CONFLICT");
  assert.equal(classifyExisting("AUTO_ALPHA"), "CONFLICT");
  assert.equal(classifyExisting("LEAVE"), "CONVERT_LEAVE");
});

test("jendela [buka, tutup): 359 belum buka, 360 buka, 599 buka, 600 tutup", () => {
  assert.equal(windowState(359, SCHEDULE), "BEFORE_OPEN");
  assert.equal(windowState(360, SCHEDULE), "OPEN");
  assert.equal(windowState(599, SCHEDULE), "OPEN");
  assert.equal(windowState(600, SCHEDULE), "CLOSED");
});

test("keterlambatan: 435 HADIR, 436 TERLAMBAT 16 menit dari bel masuk", () => {
  assert.deepEqual(computeLateness(435, SCHEDULE), { status: "HADIR", lateMinutes: null });
  assert.deepEqual(computeLateness(436, SCHEDULE), { status: "TERLAMBAT", lateMinutes: 16 });
  assert.deepEqual(computeLateness(361, SCHEDULE), { status: "HADIR", lateMinutes: null });
});

test("keterlambatan toleransi 0: 420 HADIR, 421 TERLAMBAT 1", () => {
  const strict = { ...SCHEDULE, lateToleranceMinutes: 0 };
  assert.deepEqual(computeLateness(420, strict), { status: "HADIR", lateMinutes: null });
  assert.deepEqual(computeLateness(421, strict), { status: "TERLAMBAT", lateMinutes: 1 });
});

test("keterlambatan dibatasi 720 menit (CHECK chk_attendance_late)", () => {
  const long = { openMinute: 0, startMinute: 1, lateToleranceMinutes: 0, closeMinute: 1439 };
  assert.deepEqual(computeLateness(1000, long), { status: "TERLAMBAT", lateMinutes: 720 });
});

test("umur fix = clientTime - locationTimestamp (detik, jam perangkat)", () => {
  assert.equal(fixAgeSeconds(fixAt(0, { locationTimestampMs: NOW - 180_000 })), 180);
  assert.equal(fixAgeSeconds(fixAt(0, { locationTimestampMs: NOW + 5_000 })), -5);
});

test("geofence radius 150: 150 m akurasi 5 lolos tanpa toleransi", () => {
  const result = evaluateLocation(fixAt(150, { accuracyM: 5 }), SCHOOL);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.usedTolerance, false);
});

test("geofence: 170 m akurasi 30 lolos memakai toleransi", () => {
  const result = evaluateLocation(fixAt(170, { accuracyM: 30 }), SCHOOL);
  assert.equal(result.ok && result.usedTolerance, true);
});

test("geofence: 170 m akurasi 10 ditolak OUTSIDE_GEOFENCE dengan jarak & radius", () => {
  const result = evaluateLocation(fixAt(170, { accuracyM: 10 }), SCHOOL);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.rejection.code, "OUTSIDE_GEOFENCE");
  assert.deepEqual(result.rejection.details, { distanceM: 170, radiusM: 150 });
});

test("geofence: toleransi akurasi dibatasi 50 m (210 m akurasi 80 ditolak, 199 m akurasi 80 lolos)", () => {
  assert.equal(evaluateLocation(fixAt(210, { accuracyM: 80 }), SCHOOL).ok, false);
  assert.equal(evaluateLocation(fixAt(199, { accuracyM: 80 }), SCHOOL).ok, true);
});

test("akurasi: 100 masih dievaluasi, 100.1 ditolak walau di titik pusat, null ditolak", () => {
  assert.equal(evaluateLocation(fixAt(0, { accuracyM: 100 }), SCHOOL).ok, true);
  const low = evaluateLocation(fixAt(0, { accuracyM: 100.1 }), SCHOOL);
  assert.equal(!low.ok && low.rejection.code, "GPS_ACCURACY_TOO_LOW");
  const missing = evaluateLocation(fixAt(0, { accuracyM: null }), SCHOOL);
  assert.equal(!missing.ok && missing.rejection.code, "GPS_ACCURACY_TOO_LOW");
});

test("umur fix 180 s lolos, 181 s LOCATION_STALE", () => {
  assert.equal(evaluateLocation(fixAt(0, { locationTimestampMs: NOW - 180_000 }), SCHOOL).ok, true);
  const stale = evaluateLocation(fixAt(0, { locationTimestampMs: NOW - 181_000 }), SCHOOL);
  assert.equal(!stale.ok && stale.rejection.code, "LOCATION_STALE");
  assert.deepEqual(!stale.ok && stale.rejection.details, { fixAgeS: 181, maxFixAgeS: 180 });
});

test("urutan lokasi: (0,0) > mocked > basi > akurasi > geofence", () => {
  const all = { mocked: true, locationTimestampMs: NOW - 999_000, accuracyM: 500 };
  const codeOf = (fix: LocationFix) => {
    const r = evaluateLocation(fix, SCHOOL);
    return r.ok ? "OK" : r.rejection.code;
  };
  assert.equal(codeOf({ ...fixAt(0, all), latitude: 0, longitude: 0 }), "INVALID_LOCATION");
  assert.equal(codeOf(fixAt(5000, all)), "MOCK_LOCATION");
  assert.equal(codeOf(fixAt(5000, { ...all, mocked: false })), "LOCATION_STALE");
  assert.equal(codeOf(fixAt(5000, { ...all, mocked: null, locationTimestampMs: NOW })), "GPS_ACCURACY_TOO_LOW");
  assert.equal(codeOf(fixAt(5000)), "OUTSIDE_GEOFENCE");
});

test("mocked null (iOS) tetap diproses; mocked true ditolak walau di dalam geofence", () => {
  assert.equal(evaluateLocation(fixAt(10, { mocked: null }), SCHOOL).ok, true);
  const mocked = evaluateLocation(fixAt(10, { mocked: true }), SCHOOL);
  assert.equal(!mocked.ok && mocked.rejection.code, "MOCK_LOCATION");
});

test("distanceToSchool: null untuk (0,0), selain itu dibulatkan ke meter", () => {
  assert.equal(distanceToSchool({ ...fixAt(0), latitude: 0, longitude: 0 }, SCHOOL), null);
  assert.equal(distanceToSchool(fixAt(412.4), SCHOOL), 412);
});

test("decideCheckIn: CHECKIN yang ada -> REPLAY bahkan setelah tutup & di luar geofence", () => {
  const decision = decideCheckIn(input({ existingSource: "CHECKIN", minuteOfDay: 900, fix: fixAt(9000) }));
  assert.deepEqual(decision, { kind: "REPLAY" });
});

test("decideCheckIn: ADMIN / AUTO_ALPHA -> CONFLICT", () => {
  assert.deepEqual(decideCheckIn(input({ existingSource: "ADMIN" })), { kind: "CONFLICT", source: "ADMIN" });
  assert.deepEqual(decideCheckIn(input({ existingSource: "AUTO_ALPHA" })), { kind: "CONFLICT", source: "AUTO_ALPHA" });
});

test("decideCheckIn: LEAVE tetap diperiksa lalu dikonversi", () => {
  const decision = decideCheckIn(input({ existingSource: "LEAVE" }));
  assert.equal(decision.kind, "ACCEPT");
  assert.equal(decision.kind === "ACCEPT" && decision.mode, "CONVERT_LEAVE");
  const outside = decideCheckIn(input({ existingSource: "LEAVE", fix: fixAt(900) }));
  assert.equal(outside.kind, "REJECT");
});

test("decideCheckIn: hari non-sekolah diperiksa sebelum jendela & lokasi", () => {
  const holiday = { isSchoolDay: false, reason: "HOLIDAY", holidayName: "Maulid Nabi" } as const;
  const decision = decideCheckIn(input({ day: holiday, minuteOfDay: 10, fix: fixAt(9000) }));
  assert.deepEqual(decision, { kind: "REJECT", rejection: { code: "NOT_SCHOOL_DAY", details: { reason: "HOLIDAY", holidayName: "Maulid Nabi" } } });
});

test("decideCheckIn: jendela diperiksa sebelum lokasi", () => {
  const early = decideCheckIn(input({ minuteOfDay: 359, fix: fixAt(9000) }));
  assert.deepEqual(early, { kind: "REJECT", rejection: { code: "CHECKIN_NOT_OPEN", details: { opensAt: "06:00" } } });
  const late = decideCheckIn(input({ minuteOfDay: 600, fix: fixAt(9000) }));
  assert.deepEqual(late, { kind: "REJECT", rejection: { code: "CHECKIN_CLOSED", details: { closedAt: "10:00" } } });
});

test("decideCheckIn: terima HADIR / TERLAMBAT dengan jarak & toleransi", () => {
  assert.deepEqual(decideCheckIn(input({ minuteOfDay: 435 })), {
    kind: "ACCEPT", mode: "CREATE", status: "HADIR", lateMinutes: null, distanceM: 20, usedTolerance: false,
  });
  assert.deepEqual(decideCheckIn(input({ minuteOfDay: 450, fix: fixAt(170, { accuracyM: 30 }) })), {
    kind: "ACCEPT", mode: "CREATE", status: "TERLAMBAT", lateMinutes: 30, distanceM: 170, usedTolerance: true,
  });
});

test("todayBlockReason mengikuti urutan keputusan check-in", () => {
  const open = "OPEN" as const;
  assert.equal(todayBlockReason({ existingSource: null, day: SCHOOL_DAY, window: open }), null);
  assert.equal(todayBlockReason({ existingSource: "LEAVE", day: SCHOOL_DAY, window: open }), null);
  assert.equal(todayBlockReason({ existingSource: "CHECKIN", day: SCHOOL_DAY, window: "CLOSED" }), "ALREADY_CHECKED_IN");
  assert.equal(todayBlockReason({ existingSource: "ADMIN", day: SCHOOL_DAY, window: open }), "ATTENDANCE_ALREADY_RECORDED");
  const dayOff = { isSchoolDay: false, reason: "DAY_OFF", holidayName: null } as const;
  assert.equal(todayBlockReason({ existingSource: null, day: dayOff, window: open }), "NOT_SCHOOL_DAY");
  assert.equal(todayBlockReason({ existingSource: null, day: SCHOOL_DAY, window: "BEFORE_OPEN" }), "CHECKIN_NOT_OPEN");
  assert.equal(todayBlockReason({ existingSource: null, day: SCHOOL_DAY, window: "CLOSED" }), "CHECKIN_CLOSED");
});

test("isLocationRejection hanya untuk alasan lokasi (yang dicatat untuk admin)", () => {
  for (const code of ["INVALID_LOCATION", "MOCK_LOCATION", "LOCATION_STALE", "GPS_ACCURACY_TOO_LOW", "OUTSIDE_GEOFENCE"] as const) {
    assert.equal(isLocationRejection(code), true, code);
  }
  for (const code of ["NOT_SCHOOL_DAY", "CHECKIN_NOT_OPEN", "CHECKIN_CLOSED"] as const) assert.equal(isLocationRejection(code), false, code);
});

test("pesan penolakan Bahasa Indonesia memuat angka yang relevan", () => {
  assert.equal(rejectMessage({ code: "OUTSIDE_GEOFENCE", details: { distanceM: 412, radiusM: 150 } }), "Anda berada 412 m dari sekolah (batas 150 m).");
  assert.match(rejectMessage({ code: "NOT_SCHOOL_DAY", details: { reason: "HOLIDAY", holidayName: "Idul Fitri" } }), /Idul Fitri/);
  assert.match(rejectMessage({ code: "CHECKIN_NOT_OPEN", details: { opensAt: "06:00" } }), /06:00/);
  assert.match(rejectMessage({ code: "CHECKIN_CLOSED", details: { closedAt: "10:00" } }), /10:00/);
  assert.match(rejectMessage({ code: "GPS_ACCURACY_TOO_LOW", details: { accuracyM: 150, maxAccuracyM: 100 } }), /150 m/);
  assert.match(rejectMessage({ code: "GPS_ACCURACY_TOO_LOW", details: { accuracyM: null, maxAccuracyM: 100 } }), /tidak terbaca/);
  assert.match(rejectMessage({ code: "LOCATION_STALE", details: { fixAgeS: 200, maxFixAgeS: 180 } }), /200 detik/);
  assert.match(rejectMessage({ code: "MOCK_LOCATION", details: null }), /palsu/);
  assert.match(rejectMessage({ code: "INVALID_LOCATION", details: null }), /tidak valid/);
});

test("lokasi percobaan ditolak: dibulatkan 3 desimal, dibuang bila > 2 km atau (0,0)", () => {
  const fix = { latitude: -6.914744, longitude: 107.609812, accuracyM: 23.6 };
  assert.deepEqual(rejectionLocation(fix, 412), { latitude: -6.915, longitude: 107.61, accuracyM: 24, distanceM: 412 });
  assert.deepEqual(rejectionLocation(fix, 2000), { latitude: -6.915, longitude: 107.61, accuracyM: 24, distanceM: 2000 });
  assert.deepEqual(rejectionLocation(fix, 2001), { latitude: null, longitude: null, accuracyM: 24, distanceM: 2001 });
  assert.deepEqual(rejectionLocation({ latitude: 0, longitude: 0, accuracyM: null }, null), { latitude: null, longitude: null, accuracyM: null, distanceM: null });
});
