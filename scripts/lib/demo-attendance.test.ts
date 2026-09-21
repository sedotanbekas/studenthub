import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO_ATTENDANCE_DAYS, buildDemoRow, dayNumber, demoDayPlan, offsetCoordinate } from "./demo-attendance";

const SCHEDULE = { startMinute: 420, lateToleranceMinutes: 15 };

test("demoDayPlan: deterministik, mayoritas HADIR, ada TERLAMBAT/IZIN/SAKIT/ALPHA", () => {
  const plans = Array.from({ length: 15 }, (_, s) => Array.from({ length: DEMO_ATTENDANCE_DAYS }, (_, d) => demoDayPlan(s, 20_000 + d, SCHEDULE))).flat();
  const tally = plans.reduce<Record<string, number>>((acc, p) => ({ ...acc, [p.status]: (acc[p.status] ?? 0) + 1 }), {});
  assert.equal(plans.length, 150);
  assert.ok((tally.HADIR ?? 0) >= 90, JSON.stringify(tally));
  for (const status of ["TERLAMBAT", "IZIN", "SAKIT", "ALPHA"]) assert.ok((tally[status] ?? 0) > 0, `${status}: ${JSON.stringify(tally)}`);
  assert.deepEqual(demoDayPlan(3, 20_001, SCHEDULE), demoDayPlan(3, 20_001, SCHEDULE));
});

test("demoDayPlan: jam check-in HADIR <= mulai + toleransi, TERLAMBAT > mulai + toleransi (CHECK 1..720)", () => {
  for (let s = 0; s < 15; s += 1) {
    for (let d = 0; d < 40; d += 1) {
      const plan = demoDayPlan(s, d, SCHEDULE);
      if (plan.status === "HADIR") {
        assert.equal(plan.lateMinutes, null);
        assert.ok(plan.checkInMinute !== null && plan.checkInMinute <= 435 && plan.checkInMinute >= 390);
      } else if (plan.status === "TERLAMBAT") {
        assert.ok(plan.lateMinutes !== null && plan.lateMinutes >= 16 && plan.lateMinutes <= 720);
        assert.equal(plan.checkInMinute, 420 + plan.lateMinutes);
      } else {
        assert.deepEqual([plan.lateMinutes, plan.checkInMinute, plan.offset], [null, null, null]);
      }
    }
  }
});

test("offsetCoordinate & dayNumber", () => {
  const moved = offsetCoordinate(-6.9175, 107.6191, 111.32, 0);
  assert.equal(moved.latitude, "-6.9165000");
  assert.equal(moved.longitude, "107.6191000");
  assert.equal(dayNumber("1970-01-02"), 1);
  assert.equal(dayNumber("2026-09-21") - dayNumber("2026-09-20"), 1);
});

test("buildDemoRow: HADIR berkoordinat dekat sekolah, IZIN tanpa lokasi; catatan 'data demo'", () => {
  const school = { timezone: "WIB" as const, latitude: -6.9175, longitude: 107.6191, ...SCHEDULE };
  const present = buildDemoRow({ schoolId: "s1", studentId: "st1", classId: "k1" }, "2026-09-18", demoDayPlan(0, 0, SCHEDULE), school);
  assert.equal(present.status, "HADIR");
  assert.equal(present.source, "ADMIN");
  assert.equal(present.note, "data demo");
  assert.ok(present.latitude !== null && present.distanceM !== null && present.distanceM <= 80);
  assert.ok(present.checkInAt instanceof Date);
  const leave = buildDemoRow({ schoolId: "s1", studentId: "st1", classId: "k1" }, "2026-09-18", { status: "IZIN", lateMinutes: null, checkInMinute: null, offset: null, accuracyM: 10 }, school);
  assert.deepEqual([leave.latitude, leave.longitude, leave.checkInAt, leave.accuracyM, leave.distanceM], [null, null, null, null, null]);
});
