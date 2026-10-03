import { test } from "node:test";
import assert from "node:assert/strict";
import { tallyAttendance } from "@/lib/attendance/attendance-stats";
import { STATUS_CODE } from "@/lib/attendance/monthly-recap-rules";
import { monthlyRecapSchema } from "@/lib/attendance/monthly-recap-schemas";
import { DEMO_RECAP_CLASSES, demoMonthlyRecap } from "./demo-recap";
import { DEMO_ROSTER, demoTodayRows } from "./demo-monitor";

// Selasa 15 September 2026 10:00 WIB (sebelum jam akhir: closedThrough = kemarin).
const NOW = new Date("2026-09-15T03:00:00Z");

test("demo rekap: lolos skema, deterministik, jumlah hari = panjang bulan, roster = kelas", () => {
  const recap = demoMonthlyRecap({ classId: "c0", month: "2026-09", now: NOW });
  assert.doesNotThrow(() => monthlyRecapSchema.parse(recap));
  assert.deepEqual(demoMonthlyRecap({ classId: "c0", month: "2026-09", now: NOW }), recap);
  assert.equal(recap.days.length, 30);
  assert.deepEqual(recap.class, DEMO_RECAP_CLASSES[0]);
  assert.deepEqual(recap.students.map((s) => s.name).sort(), DEMO_ROSTER.filter((s) => s.className === "X IPA 1").map((s) => s.name).sort());
  assert.equal(recap.closedThrough, "2026-09-14");
  assert.equal(JSON.stringify(recap).includes("nisn"), false);
  const other = demoMonthlyRecap({ classId: "c1", month: "2026-09", now: NOW });
  assert.notDeepEqual(other.students.map((s) => s.studentId), recap.students.map((s) => s.studentId));
});

test("demo rekap: kolom hari ini = peta contoh; hari mendatang kosong; Minggu & 17 Agustus libur", () => {
  const recap = demoMonthlyRecap({ classId: "c0", month: "2026-09", now: NOW });
  const today = new Map(demoTodayRows("2026-09-15").map((r) => [r.studentId, r]));
  for (const s of recap.students) {
    const row = today.get(s.studentId);
    assert.equal(s.cells[14], row ? STATUS_CODE[row.status] : null, s.name);
    assert.deepEqual(s.cells.slice(15), Array(15).fill(null), "hari mendatang");
  }
  assert.deepEqual([recap.days[14]?.closure, recap.days[13]?.closure, recap.days[12]?.reason], ["OPEN", "CLOSED", "DAY_OFF"]);
  const august = demoMonthlyRecap({ classId: "c0", month: "2026-08", now: NOW });
  assert.deepEqual([august.days[16]?.reason, august.days[16]?.holidayName, august.isFinal], ["HOLIDAY", "HUT RI", true]);
});

test("demo rekap: total siswa = tally sel tertutup; total kelas = jumlah siswa", () => {
  const recap = demoMonthlyRecap({ classId: "c2", month: "2026-08", now: NOW });
  const letterToStatus = { H: "HADIR", T: "TERLAMBAT", I: "IZIN", S: "SAKIT", A: "ALPHA" } as const;
  for (const s of recap.students) {
    const counted = s.cells.flatMap((c) => (c && c !== "K" ? [{ status: letterToStatus[c] }] : []));
    assert.deepEqual([s.totals.hadir, s.totals.terlambat, s.totals.izin, s.totals.sakit, s.totals.alpha], (({ counts }) => [counts.hadir, counts.terlambat, counts.izin, counts.sakit, counts.alpha])(tallyAttendance(counted)));
  }
  assert.equal(recap.totals.recorded, recap.students.reduce((sum, s) => sum + s.totals.recorded, 0));
  assert.ok(recap.totals.terlambat > 0 && recap.totals.lateReasons.filled > 0, "data contoh punya keterlambatan beralasan");
});
