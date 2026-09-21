import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays, diffDays, eachDate, formatMinute, fromDbDate, instantAtLocal, localParts,
  monthRange, parseLocalDate, TZ_IANA, TZ_OFFSET_MINUTES, toDbDate, wibDate, type SchoolTz,
} from "./zone";

test("localParts WIB: 23:30Z kemarin = 06:30 Senin", () => {
  const p = localParts(new Date("2026-09-20T23:30:00Z"), "WIB");
  assert.equal(p.ymd, "2026-09-21");
  assert.equal(p.minuteOfDay, 390);
  assert.equal(p.weekdayIdx, 0);
  assert.equal(p.weekdayBit, 1);
});

test("localParts WIT & WITA di batas tanggal", () => {
  assert.deepEqual([localParts(new Date("2026-09-20T15:00:00Z"), "WIT").ymd, localParts(new Date("2026-09-20T15:00:00Z"), "WIT").minuteOfDay], ["2026-09-21", 0]);
  const wita = localParts(new Date("2026-09-21T15:59:00Z"), "WITA");
  assert.equal(wita.ymd, "2026-09-21");
  assert.equal(wita.minuteOfDay, 23 * 60 + 59);
});

test("Minggu memakai bit 64", () => {
  assert.equal(localParts(new Date("2026-09-20T05:00:00Z"), "WIB").weekdayBit, 64);
});

test("offset cocok dengan Intl untuk ketiga zona", () => {
  const instants = ["2026-01-01T00:00:00Z", "2026-06-15T12:34:00Z", "2026-12-31T16:59:00Z"];
  for (const tz of Object.keys(TZ_OFFSET_MINUTES) as SchoolTz[]) {
    for (const iso of instants) {
      const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ_IANA[tz], year: "numeric", month: "2-digit", day: "2-digit" });
      assert.equal(localParts(new Date(iso), tz).ymd, fmt.format(new Date(iso)));
    }
  }
});

test("wibDate 16:59:59Z vs 17:00Z", () => {
  assert.equal(wibDate(new Date("2026-09-20T16:59:59.999Z")), "2026-09-20");
  assert.equal(wibDate(new Date("2026-09-20T17:00:00Z")), "2026-09-21");
});

test("parseLocalDate menolak tanggal mustahil", () => {
  assert.equal(parseLocalDate("2026-02-30"), null);
  assert.equal(parseLocalDate("2028-02-29"), "2028-02-29");
  assert.equal(parseLocalDate("26-02-01"), null);
});

test("toDbDate/fromDbDate roundtrip", () => {
  assert.equal(toDbDate("2026-09-21").toISOString(), "2026-09-21T00:00:00.000Z");
  assert.equal(fromDbDate(toDbDate("2026-09-21")), "2026-09-21");
  assert.throws(() => toDbDate("2026-13-01"), RangeError);
});

test("aritmetika tanggal lintas bulan & tahun kabisat", () => {
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(diffDays("2026-10-01", "2026-09-21"), 10);
  assert.deepEqual(eachDate("2026-12-30", "2027-01-02"), ["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
  assert.deepEqual(eachDate("2026-01-02", "2026-01-01"), []);
});

test("instantAtLocal adalah kebalikan localParts", () => {
  const instant = instantAtLocal("2026-09-21", 435, "WITA");
  assert.equal(instant.toISOString(), "2026-09-20T23:15:00.000Z");
  const back = localParts(instant, "WITA");
  assert.deepEqual([back.ymd, back.minuteOfDay], ["2026-09-21", 435]);
});

test("monthRange & formatMinute", () => {
  assert.deepEqual(monthRange("2028-02"), { from: "2028-02-01", to: "2028-02-29" });
  assert.equal(monthRange("2026-13"), null);
  assert.equal(formatMinute(435), "07:15");
});
