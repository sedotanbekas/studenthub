import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AUTO_ALPHA_LOOKBACK_DAYS,
  activatedBefore,
  candidateCloseDates,
  chunk,
  holidayDates,
  isEligibleOn,
  isSettledRun,
  lookbackRunKeys,
  planDayClose,
  reopenDates,
  summarizeDrafts,
  type CloseCandidate,
  type CoveringLeave,
} from "./auto-alpha-rules";

const LONG_AGO = new Date("2025-01-01T00:00:00Z");
const wib = { timezone: "WIB" as const, dayEndMinute: 900, createdAt: LONG_AGO };
const wit = { timezone: "WIT" as const, dayEndMinute: 900, createdAt: LONG_AGO };
const NONE: ReadonlySet<string> = new Set();

test("WIB dayEnd 15:00: 07:59Z belum menutup hari ini, 08:00Z menutup hari ini", () => {
  const before = candidateCloseDates(new Date("2026-09-21T07:59:00Z"), wib, NONE);
  assert.equal(before.at(-1), "2026-09-20");
  assert.equal(before.length, AUTO_ALPHA_LOOKBACK_DAYS);
  const after = candidateCloseDates(new Date("2026-09-21T08:00:00Z"), wib, NONE);
  assert.equal(after.at(-1), "2026-09-21");
  assert.equal(after[0], "2026-09-14");
  assert.equal(after.length, AUTO_ALPHA_LOOKBACK_DAYS + 1);
});

test("instant yang sama berbeda hasil untuk sekolah WIT (sudah lewat 15:00 WIT)", () => {
  const now = new Date("2026-09-21T07:59:00Z");
  assert.equal(candidateCloseDates(now, wit, NONE).at(-1), "2026-09-21");
  assert.equal(candidateCloseDates(now, wib, NONE).at(-1), "2026-09-20");
});

test("batas tanggal WIT: 15:30Z sudah tanggal berikutnya lokal (00:30), hari itu belum ditutup", () => {
  const dates = candidateCloseDates(new Date("2026-09-20T15:30:00Z"), wit, NONE);
  assert.equal(dates.at(-1), "2026-09-20");
  assert.equal(dates[0], "2026-09-14");
});

test("lookback berhenti di tanggal lokal createdAt sekolah dan melewati kunci yang selesai", () => {
  const school = { ...wib, createdAt: new Date("2026-09-18T20:00:00Z") }; // 2026-09-19 03:00 WIB
  const dates = candidateCloseDates(new Date("2026-09-21T09:00:00Z"), school, new Set(["2026-09-20"]));
  assert.deepEqual(dates, ["2026-09-19", "2026-09-21"]);
});

test("sekolah baru dibuat hari ini sebelum dayEnd -> tidak ada kandidat", () => {
  const school = { ...wib, createdAt: new Date("2026-09-21T01:00:00Z") };
  assert.deepEqual(candidateCloseDates(new Date("2026-09-21T02:00:00Z"), school, NONE), []);
});

test("lookbackRunKeys mencakup WIB hari ini - 7 s.d. WIT hari ini", () => {
  const keys = lookbackRunKeys(new Date("2026-09-20T16:00:00Z")); // WIB 09-20 23:00, WIT 09-21 01:00
  assert.equal(keys[0], "2026-09-13");
  assert.equal(keys.at(-1), "2026-09-21");
  assert.equal(keys.length, 9);
});

test("isSettledRun: SUCCEEDED dan FAILED yang kehabisan percobaan dianggap selesai", () => {
  assert.equal(isSettledRun({ status: "SUCCEEDED", attempts: 1 }), true);
  assert.equal(isSettledRun({ status: "FAILED", attempts: 5 }), true);
  assert.equal(isSettledRun({ status: "FAILED", attempts: 1 }), false);
  assert.equal(isSettledRun({ status: "RUNNING", attempts: 1 }), false);
});

test("isEligibleOn: tanggal lokal activatedAt menurut zona sekolah", () => {
  const student = { status: "ACTIVE" as const, activatedAt: new Date("2026-09-20T15:30:00Z") };
  assert.equal(isEligibleOn(student, "2026-09-21", "WIT"), true);
  assert.equal(isEligibleOn(student, "2026-09-20", "WIT"), false, "WIT: aktif 2026-09-21 00:30 lokal");
  assert.equal(isEligibleOn(student, "2026-09-20", "WIB"), true, "WIB: aktif 2026-09-20 22:30 lokal");
  assert.equal(isEligibleOn({ ...student, status: "INACTIVE" }, "2026-09-22", "WIB"), false);
  assert.equal(isEligibleOn({ ...student, activatedAt: null }, "2026-09-22", "WIB"), false);
});

test("activatedBefore = awal hari berikutnya lokal (batas eksklusif kueri)", () => {
  assert.equal(activatedBefore("2026-09-21", "WIT").toISOString(), "2026-09-21T15:00:00.000Z");
  assert.equal(activatedBefore("2026-09-21", "WIB").toISOString(), "2026-09-21T17:00:00.000Z");
});

const candidate = (id: string, overrides: Partial<CloseCandidate> = {}): CloseCandidate => ({
  id,
  status: "ACTIVE",
  activatedAt: new Date("2026-09-01T00:00:00Z"),
  currentClassId: `class-${id}`,
  ...overrides,
});

const leave = (overrides: Partial<CoveringLeave> = {}): CoveringLeave => ({
  id: "leave-1",
  studentId: "s1",
  type: "SAKIT",
  startDate: "2026-09-20",
  endDate: "2026-09-22",
  ...overrides,
});

test("planDayClose: izin disetujui -> LEAVE, lainnya ALPHA dengan snapshot kelas", () => {
  const drafts = planDayClose("2026-09-21", [candidate("s1"), candidate("s2", { currentClassId: null })], [leave()], "WIB");
  assert.deepEqual(drafts, [
    { studentId: "s1", classId: "class-s1", status: "SAKIT", source: "LEAVE", leaveRequestId: "leave-1" },
    { studentId: "s2", classId: null, status: "ALPHA", source: "AUTO_ALPHA", leaveRequestId: null },
  ]);
  assert.deepEqual(summarizeDrafts(drafts), { alpha: 1, leave: 1 });
});

test("planDayClose: izin di luar tanggal tidak melindungi; siswa belum aktif pada tanggal dilewati", () => {
  const late = candidate("s3", { activatedAt: new Date("2026-09-21T18:00:00Z") }); // 22 Sep WIB
  const drafts = planDayClose("2026-09-21", [candidate("s1"), late], [leave({ startDate: "2026-09-22", endDate: "2026-09-23" })], "WIB");
  assert.deepEqual(drafts.map((d) => [d.studentId, d.status]), [["s1", "ALPHA"]]);
  assert.deepEqual(planDayClose("2026-09-21", [], [leave()], "WIB"), []);
});

test("planDayClose: dua izin mencakup tanggal -> dipilih deterministik (mulai paling awal)", () => {
  const leaves = [leave({ id: "b", type: "IZIN", startDate: "2026-09-21" }), leave({ id: "a", type: "SAKIT", startDate: "2026-09-19" })];
  const [draft] = planDayClose("2026-09-21", [candidate("s1")], leaves, "WIB");
  assert.equal(draft?.leaveRequestId, "a");
  assert.equal(draft?.status, "SAKIT");
});

test("chunk memecah daftar menjadi potongan berukuran tetap", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 500), []);
  assert.throws(() => chunk([1], 0), RangeError);
});

test("holidayDates: tanggal dalam rentang yang ditutup libur (inklusif)", () => {
  const holidays = [{ startDate: "2026-09-18", endDate: "2026-09-20" }, { startDate: "2026-09-23", endDate: "2026-09-23" }];
  assert.deepEqual(holidayDates("2026-09-19", "2026-09-24", holidays), ["2026-09-19", "2026-09-20", "2026-09-23"]);
  assert.deepEqual(holidayDates("2026-09-24", "2026-09-19", holidays), []);
});

test("reopenDates: hanya dalam jendela lookback, tidak di masa depan, tanpa tanggal yang masih libur", () => {
  const today = "2026-09-21";
  assert.deepEqual(reopenDates({ from: "2026-09-01", to: "2026-09-30" }, today, new Set(["2026-09-16"])), [
    "2026-09-14",
    "2026-09-15",
    "2026-09-17",
    "2026-09-18",
    "2026-09-19",
    "2026-09-20",
    "2026-09-21",
  ]);
  assert.deepEqual(reopenDates({ from: "2026-09-01", to: "2026-09-10" }, today, new Set()), []);
});
