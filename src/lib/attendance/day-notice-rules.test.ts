import { test } from "node:test";
import assert from "node:assert/strict";
import { LEAVE_MAX_BACKDATE_DAYS } from "./leave-constants";
import { earliestLeaveStart } from "./leave-rules";
import {
  ALPHA_NOTICE_MAX_AGE_DAYS,
  DAY_SUMMARY_MAX_AGE_DAYS,
  alphaNoticeKey,
  dayCountsFrom,
  daySummaryKey,
  holdAlphaNotices,
  isFreshClose,
  isNotableDay,
  leaveDeadlineFor,
  planAlphaNotices,
  type PendingLeaveRef,
} from "./day-notice-rules";

const D = "2031-03-18";

test("isFreshClose: umur 0..max saja, tanggal depan tidak pernah", () => {
  assert.equal(isFreshClose(D, D, 3), true);
  assert.equal(isFreshClose("2031-03-15", D, 3), true, "umur 3 = batas");
  assert.equal(isFreshClose("2031-03-14", D, 3), false, "umur 4");
  assert.equal(isFreshClose("2031-03-19", D, 3), false, "tanggal depan");
  assert.equal(isFreshClose("2031-03-17", D, 1), true, "kemarin, max 1");
  assert.equal(isFreshClose("2031-03-16", D, 1), false, "2 hari lalu, max 1");
  assert.equal(isFreshClose("2031-02-28", "2031-03-01", DAY_SUMMARY_MAX_AGE_DAYS), true, "lintas bulan");
});

test("setiap notifikasi Alpa yang dikirim masih bisa ditindaklanjuti dengan pengajuan izin", () => {
  assert.ok(ALPHA_NOTICE_MAX_AGE_DAYS < LEAVE_MAX_BACKDATE_DAYS);
  assert.ok(DAY_SUMMARY_MAX_AGE_DAYS <= ALPHA_NOTICE_MAX_AGE_DAYS);
});

test("leaveDeadlineFor: hari terakhir pengajuan mundur siswa masih mencakup tanggal itu", () => {
  const deadline = leaveDeadlineFor(D);
  assert.equal(deadline, "2031-03-25");
  assert.equal(earliestLeaveStart(deadline, "STUDENT"), D);
});

test("kunci dedup stabil dan <= 64 karakter", () => {
  assert.equal(alphaNoticeKey(D), "attendance-alpha:2031-03-18");
  assert.equal(daySummaryKey(D), "attendance-summary:2031-03-18");
  assert.ok(alphaNoticeKey(D).length <= 64 && daySummaryKey(D).length <= 64);
});

const leave = (id: string, studentId: string, startDate: string, endDate: string, type: PendingLeaveRef["type"] = "SAKIT"): PendingLeaveRef => ({ id, studentId, type, startDate, endDate });

test("planAlphaNotices: id unik & urut; izin PENDING yang mencakup tanggal -> varian tertunda", () => {
  const plan = planAlphaNotices(D, ["s3", "s1", "s2", "s1"], [leave("L1", "s2", "2031-03-17", "2031-03-19", "IZIN")]);
  assert.deepEqual(plan.plain, ["s1", "s3"]);
  assert.deepEqual(plan.pending, [{ studentId: "s2", leaveId: "L1", type: "IZIN" }]);
});

test("planAlphaNotices: izin yang tidak mencakup tanggal / milik siswa lain diabaikan", () => {
  const plan = planAlphaNotices(D, ["s1", "s2"], [leave("L1", "s1", "2031-03-19", "2031-03-20"), leave("L2", "s1", "2031-03-10", "2031-03-17"), leave("L3", "s9", D, D)]);
  assert.deepEqual(plan.plain, ["s1", "s2"]);
  assert.deepEqual(plan.pending, []);
});

test("planAlphaNotices: dua izin PENDING -> mulai paling awal, lalu id terkecil", () => {
  const earliest = planAlphaNotices(D, ["s1"], [leave("L9", "s1", D, D, "IZIN"), leave("L5", "s1", "2031-03-16", D)]);
  assert.deepEqual(earliest.pending, [{ studentId: "s1", leaveId: "L5", type: "SAKIT" }]);
  const tie = planAlphaNotices(D, ["s1"], [leave("L9", "s1", D, D, "IZIN"), leave("L2", "s1", D, D)]);
  assert.deepEqual(tie.pending, [{ studentId: "s1", leaveId: "L2", type: "SAKIT" }]);
  assert.deepEqual(planAlphaNotices(D, [], [leave("L1", "s1", D, D)]), { plain: [], pending: [] });
});

test("dayCountsFrom: ALPHA/TERLAMBAT/IZIN/SAKIT dipetakan, HADIR diabaikan, status hilang = 0", () => {
  assert.deepEqual(
    dayCountsFrom([{ status: "HADIR", count: 900 }, { status: "ALPHA", count: 8 }, { status: "TERLAMBAT", count: 24 }, { status: "SAKIT", count: 12 }], 3),
    { alpha: 8, late: 24, izin: 0, sakit: 12, pendingAnomalies: 3 },
  );
  assert.deepEqual(dayCountsFrom([], 0), { alpha: 0, late: 0, izin: 0, sakit: 0, pendingAnomalies: 0 });
});

test("isNotableDay: hanya Alpa, terlambat, atau anomali yang perlu ditinjau", () => {
  const zero = { alpha: 0, late: 0, izin: 0, sakit: 0, pendingAnomalies: 0 };
  assert.equal(isNotableDay(zero), false);
  assert.equal(isNotableDay({ ...zero, izin: 5, sakit: 2 }), false);
  assert.equal(isNotableDay({ ...zero, alpha: 1 }), true);
  assert.equal(isNotableDay({ ...zero, late: 1 }), true);
  assert.equal(isNotableDay({ ...zero, pendingAnomalies: 1 }), true);
});

test("holdAlphaNotices: tanpa satu pun check-in, Alpa massal ditahan (libur belum dicatat / gangguan)", () => {
  assert.equal(holdAlphaNotices({ checkins: 0, alpha: 30 }), true);
  assert.equal(holdAlphaNotices({ checkins: 1, alpha: 30 }), false);
  assert.equal(holdAlphaNotices({ checkins: 0, alpha: 0 }), false, "tanpa Alpa tidak ada yang ditahan");
});
