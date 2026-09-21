import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HOLIDAY_BACKDATE_DAYS,
  MAX_HOLIDAY_DAYS,
  backdateLimitDate,
  checkSchoolDay,
  describeDays,
  holidayPeriod,
  monthKeyOf,
  isWithinBackdateLimit,
  listSchoolDays,
  validateHolidayRange,
  weekdayBitOf,
  type CalendarContext,
} from "./rules";

const TERMS = [
  { startDate: "2026-07-13", endDate: "2026-12-19" },
  { startDate: "2027-01-04", endDate: "2027-06-26" },
];

function ctx(overrides: Partial<CalendarContext> = {}): CalendarContext {
  return { schoolDaysMask: 31, holidays: [], terms: TERMS, ...overrides };
}

test("weekdayBitOf: Senin = 1, Sabtu = 32, Minggu = 64", () => {
  assert.equal(weekdayBitOf("2026-09-21"), 1);
  assert.equal(weekdayBitOf("2026-09-26"), 32);
  assert.equal(weekdayBitOf("2026-09-27"), 64);
});

test("mask 31: Senin-Jumat hari sekolah, Sabtu DAY_OFF", () => {
  assert.deepEqual(checkSchoolDay("2026-09-21", ctx()), { date: "2026-09-21", isSchoolDay: true, reason: "SCHOOL_DAY", holidayName: null });
  assert.deepEqual(checkSchoolDay("2026-09-25", ctx()).reason, "SCHOOL_DAY");
  assert.deepEqual(checkSchoolDay("2026-09-26", ctx()), { date: "2026-09-26", isSchoolDay: false, reason: "DAY_OFF", holidayName: null });
});

test("mask 63: Sabtu hari sekolah, Minggu libur", () => {
  const six = ctx({ schoolDaysMask: 63 });
  assert.equal(checkSchoolDay("2026-09-26", six).isSchoolDay, true);
  assert.equal(checkSchoolDay("2026-09-27", six).reason, "DAY_OFF");
});

test("libur nasional inklusif di kedua ujung", () => {
  const c = ctx({ holidays: [{ name: "Libur Sekolah", startDate: "2026-10-05", endDate: "2026-10-07" }] });
  assert.deepEqual(checkSchoolDay("2026-10-05", c), { date: "2026-10-05", isSchoolDay: false, reason: "HOLIDAY", holidayName: "Libur Sekolah" });
  assert.equal(checkSchoolDay("2026-10-07", c).reason, "HOLIDAY");
  assert.equal(checkSchoolDay("2026-10-08", c).reason, "SCHOOL_DAY");
  assert.equal(checkSchoolDay("2026-10-02", c).reason, "SCHOOL_DAY");
});

test("celah antar-semester -> OUTSIDE_TERM", () => {
  assert.equal(checkSchoolDay("2026-12-21", ctx()).reason, "OUTSIDE_TERM");
  assert.equal(checkSchoolDay("2027-01-04", ctx()).reason, "SCHOOL_DAY");
  assert.equal(checkSchoolDay("2026-07-10", ctx()).reason, "OUTSIDE_TERM");
  assert.equal(checkSchoolDay("2026-09-21", ctx({ terms: [] })).reason, "OUTSIDE_TERM");
});

test("prioritas HOLIDAY > OUTSIDE_TERM > DAY_OFF", () => {
  const c = ctx({
    holidays: [
      { name: "Hari Minggu Istimewa", startDate: "2026-09-27", endDate: "2026-09-27" },
      { name: "Natal", startDate: "2026-12-25", endDate: "2026-12-25" },
    ],
  });
  assert.equal(checkSchoolDay("2026-09-27", c).reason, "HOLIDAY");
  assert.equal(checkSchoolDay("2026-12-25", c).reason, "HOLIDAY");
  // 2026-12-20 hari Minggu di luar semester: OUTSIDE_TERM mengalahkan DAY_OFF.
  assert.equal(checkSchoolDay("2026-12-20", c).reason, "OUTSIDE_TERM");
});

test("libur bertumpuk: nama dari libur yang mulai paling awal", () => {
  const c = ctx({
    holidays: [
      { name: "Cuti Bersama Idulfitri", startDate: "2026-03-20", endDate: "2026-03-24" },
      { name: "Idulfitri", startDate: "2026-03-21", endDate: "2026-03-22" },
    ],
    terms: [{ startDate: "2026-01-05", endDate: "2026-06-20" }],
  });
  assert.equal(checkSchoolDay("2026-03-21", c).holidayName, "Cuti Bersama Idulfitri");
});

test("tanggal tidak valid dilempar RangeError", () => {
  assert.throws(() => checkSchoolDay("2026-02-30", ctx()), RangeError);
});

test("listSchoolDays melewati akhir pekan dan libur", () => {
  assert.deepEqual(listSchoolDays("2026-09-21", "2026-09-27", ctx()), [
    "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25",
  ]);
  const withHoliday = ctx({ holidays: [{ name: "Rapat Guru", startDate: "2026-09-23", endDate: "2026-09-23" }] });
  assert.deepEqual(listSchoolDays("2026-09-21", "2026-09-25", withHoliday), ["2026-09-21", "2026-09-22", "2026-09-24", "2026-09-25"]);
});

test("listSchoolDays kosong bila semua hari libur atau rentang terbalik", () => {
  const all = ctx({ holidays: [{ name: "Libur Semester", startDate: "2026-09-01", endDate: "2026-09-30" }] });
  assert.deepEqual(listSchoolDays("2026-09-21", "2026-09-25", all), []);
  assert.deepEqual(listSchoolDays("2026-09-25", "2026-09-21", ctx()), []);
});

test("describeDays mengembalikan setiap tanggal dalam rentang", () => {
  const days = describeDays("2026-09-01", "2026-09-30", ctx());
  assert.equal(days.length, 30);
  assert.equal(days[0]?.date, "2026-09-01");
  assert.equal(days.filter((d) => d.isSchoolDay).length, 22);
});

test("validateHolidayRange: urutan tanggal & panjang maksimal", () => {
  assert.equal(validateHolidayRange({ startDate: "2026-08-17", endDate: "2026-08-17" }), null);
  assert.equal(validateHolidayRange({ startDate: "2026-08-18", endDate: "2026-08-17" })?.code, "INVALID_DATE_RANGE");
  assert.equal(MAX_HOLIDAY_DAYS, 60);
  assert.equal(validateHolidayRange({ startDate: "2026-06-01", endDate: "2026-07-30" }), null);
  assert.equal(validateHolidayRange({ startDate: "2026-06-01", endDate: "2026-07-31" })?.code, "HOLIDAY_TOO_LONG");
});

test("batas backdate admin sekolah = hari ini - 7", () => {
  assert.equal(HOLIDAY_BACKDATE_DAYS, 7);
  assert.equal(backdateLimitDate("2026-09-21"), "2026-09-14");
  assert.equal(isWithinBackdateLimit("2026-09-14", "2026-09-21"), true);
  assert.equal(isWithinBackdateLimit("2026-09-13", "2026-09-21"), false);
  assert.equal(isWithinBackdateLimit("2026-12-01", "2026-09-21"), true);
});

test("holidayPeriod: satu tahun penuh atau satu bulan", () => {
  assert.deepEqual(holidayPeriod(2026, undefined), { from: "2026-01-01", to: "2026-12-31" });
  assert.deepEqual(holidayPeriod(2028, 2), { from: "2028-02-01", to: "2028-02-29" });
  assert.deepEqual(holidayPeriod(2026, 9), { from: "2026-09-01", to: "2026-09-30" });
});

test("monthKeyOf: YYYY-MM dari tanggal lokal", () => {
  assert.equal(monthKeyOf("2026-09-21"), "2026-09");
});
