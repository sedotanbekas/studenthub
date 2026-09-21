import { test } from "node:test";
import assert from "node:assert/strict";
import { closedThrough } from "./auto-alpha-rules";
import {
  checkInMessage,
  countStatuses,
  countsFromGroups,
  isHistoryMonthAllowed,
  localTimeOf,
  minDate,
  monthNavigation,
  monthSummary,
  presentPct,
  termCounts,
  toCheckInAttendanceDto,
  toHistoryDay,
  toTodayRecord,
  type AttendanceRow,
} from "./student-dto";

const ROW: AttendanceRow = {
  id: "att_1",
  date: new Date("2026-09-21T00:00:00.000Z"),
  status: "TERLAMBAT",
  source: "CHECKIN",
  checkInAt: new Date("2026-09-21T00:16:30.000Z"),
  lateMinutes: 16,
  distanceM: 42,
  leaveRequestId: null,
};

test("DTO check-in memakai jam lokal sekolah (WIB 07:16, WIT 09:16)", () => {
  assert.deepEqual(toCheckInAttendanceDto(ROW, "WIB"), {
    id: "att_1",
    date: "2026-09-21",
    status: "TERLAMBAT",
    lateMinutes: 16,
    checkInAt: "2026-09-21T00:16:30.000Z",
    checkInTimeLocal: "07:16",
    distanceM: 42,
    source: "CHECKIN",
  });
  assert.equal(toCheckInAttendanceDto(ROW, "WIT").checkInTimeLocal, "09:16");
  assert.throws(() => toCheckInAttendanceDto({ ...ROW, checkInAt: null }, "WIB"));
});

test("record hari ini & hari riwayat: baris tanpa check-in -> jam null", () => {
  const leave: AttendanceRow = { ...ROW, status: "IZIN", source: "LEAVE", checkInAt: null, lateMinutes: null, leaveRequestId: "lr_1" };
  assert.deepEqual(toTodayRecord(leave, "WIB"), { id: "att_1", status: "IZIN", source: "LEAVE", checkInTimeLocal: null, lateMinutes: null });
  assert.equal(toTodayRecord(null, "WIB"), null);
  assert.deepEqual(toHistoryDay(leave, "WITA"), {
    date: "2026-09-21", status: "IZIN", source: "LEAVE", checkInTimeLocal: null, lateMinutes: null, leaveRequestId: "lr_1",
  });
  assert.equal(localTimeOf(null, "WIB"), null);
});

test("hitungan status & persentase hadir (TERLAMBAT termasuk hadir, 1 desimal, null bila kosong)", () => {
  const counts = countStatuses(["HADIR", "HADIR", "TERLAMBAT", "IZIN", "SAKIT", "ALPHA"]);
  assert.deepEqual(counts, { HADIR: 2, TERLAMBAT: 1, IZIN: 1, SAKIT: 1, ALPHA: 1 });
  assert.equal(presentPct(counts), 50);
  assert.equal(presentPct(countStatuses(["HADIR", "HADIR", "ALPHA"])), 66.7);
  assert.equal(presentPct(countStatuses([])), null);
  assert.deepEqual(monthSummary(counts), { recorded: 6, present: 3, late: 1, izin: 1, sakit: 1, alpha: 1, presentPct: 50 });
  assert.deepEqual(termCounts(counts), { recorded: 6, hadir: 2, terlambat: 1, izin: 1, sakit: 1, alpha: 1, presentPct: 50 });
});

test("countsFromGroups melengkapi status yang tidak muncul dengan 0", () => {
  assert.deepEqual(countsFromGroups([{ status: "ALPHA", count: 2 }, { status: "HADIR", count: 5 }]), { HADIR: 5, TERLAMBAT: 0, IZIN: 0, SAKIT: 0, ALPHA: 2 });
});

test("closedThrough: sebelum akhir hari = kemarin; sesudahnya = hari ini (per zona waktu)", () => {
  const instant = new Date("2026-09-21T07:59:00.000Z");
  assert.equal(closedThrough(instant, "WIB", 900), "2026-09-20");
  assert.equal(closedThrough(new Date("2026-09-21T08:00:00.000Z"), "WIB", 900), "2026-09-21");
  assert.equal(closedThrough(instant, "WIT", 900), "2026-09-21");
  assert.equal(minDate("2026-09-20", "2026-09-30"), "2026-09-20");
});

test("bulan riwayat: bulan berjalan s.d. 24 bulan ke belakang; bulan depan ditolak", () => {
  assert.equal(isHistoryMonthAllowed("2026-09", "2026-09"), true);
  assert.equal(isHistoryMonthAllowed("2024-09", "2026-09"), true);
  assert.equal(isHistoryMonthAllowed("2024-08", "2026-09"), false);
  assert.equal(isHistoryMonthAllowed("2026-10", "2026-09"), false);
});

test("navigasi bulan melintasi tahun dan berhenti di batas", () => {
  assert.deepEqual(monthNavigation("2026-01", "2026-09"), { prevMonth: "2025-12", nextMonth: "2026-02" });
  assert.deepEqual(monthNavigation("2026-09", "2026-09"), { prevMonth: "2026-08", nextMonth: null });
  assert.deepEqual(monthNavigation("2024-09", "2026-09"), { prevMonth: null, nextMonth: "2024-10" });
});

test("pesan check-in: hadir, terlambat, replay", () => {
  assert.equal(checkInMessage({ status: "HADIR", lateMinutes: null, checkInTimeLocal: "06:55" }, false), "Absensi berhasil. Anda tercatat Hadir pukul 06:55.");
  assert.match(checkInMessage({ status: "TERLAMBAT", lateMinutes: 16, checkInTimeLocal: "07:16" }, false), /Terlambat 16 menit/);
  assert.match(checkInMessage({ status: "HADIR", lateMinutes: null, checkInTimeLocal: "06:55" }, true), /sudah tercatat/);
});
