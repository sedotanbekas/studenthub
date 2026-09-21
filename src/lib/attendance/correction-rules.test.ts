import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCorrectionPatch, CORRECTION_WINDOW_DAYS, lateMinutesProblem, validateCorrection, type AttendanceSnapshot } from "./correction-rules";

const TODAY = "2026-09-21";
const check = (date: string, overrides: Partial<Parameters<typeof validateCorrection>[0]> = {}) =>
  validateCorrection({ date, today: TODAY, isSchoolDay: true, windowLimited: true, ...overrides });

test("tanggal masa depan ditolak FUTURE_DATE; hari ini boleh", () => {
  assert.equal(check("2026-09-22")?.code, "FUTURE_DATE");
  assert.equal(check(TODAY), null);
});

test("jendela 45 hari untuk admin sekolah; super admin tanpa batas", () => {
  assert.equal(CORRECTION_WINDOW_DAYS, 45);
  assert.equal(check("2026-08-07"), null, "tepat 45 hari");
  assert.equal(check("2026-08-06")?.code, "CORRECTION_WINDOW_EXPIRED");
  assert.equal(check("2026-08-06", { windowLimited: false }), null);
  assert.equal(check("2025-01-06", { windowLimited: false }), null);
});

test("bukan hari sekolah -> NOT_SCHOOL_DAY (dicek sebelum jendela)", () => {
  assert.equal(check("2026-09-20", { isSchoolDay: false })?.code, "NOT_SCHOOL_DAY");
  assert.equal(check("2026-08-01", { isSchoolDay: false })?.code, "NOT_SCHOOL_DAY");
  assert.equal(check("2026-09-30", { isSchoolDay: false })?.code, "FUTURE_DATE");
});

test("lateMinutes wajib 1..720 hanya untuk TERLAMBAT", () => {
  assert.match(lateMinutesProblem("TERLAMBAT", undefined) ?? "", /wajib/);
  assert.match(lateMinutesProblem("TERLAMBAT", null) ?? "", /wajib/);
  assert.notEqual(lateMinutesProblem("TERLAMBAT", 0), null);
  assert.notEqual(lateMinutesProblem("TERLAMBAT", 721), null);
  assert.notEqual(lateMinutesProblem("TERLAMBAT", 1.5), null);
  assert.equal(lateMinutesProblem("TERLAMBAT", 1), null);
  assert.equal(lateMinutesProblem("TERLAMBAT", 720), null);
  assert.match(lateMinutesProblem("HADIR", 5) ?? "", /TERLAMBAT/);
  assert.equal(lateMinutesProblem("HADIR", null), null);
  assert.equal(lateMinutesProblem("ALPHA", undefined), null);
});

const checkin: AttendanceSnapshot = { status: "TERLAMBAT", source: "CHECKIN", lateMinutes: 16, note: null };

test("tanpa baris -> create sumber ADMIN dengan catatan alasan", () => {
  const plan = buildCorrectionPatch(null, { status: "HADIR", lateMinutes: null, reason: "Surat dispensasi lomba" });
  assert.deepEqual(plan, {
    kind: "create",
    before: null,
    after: { status: "HADIR", source: "ADMIN", lateMinutes: null, note: "Surat dispensasi lomba" },
  });
});

test("status & menit terlambat sama -> noop (tanpa audit/notifikasi)", () => {
  const plan = buildCorrectionPatch(checkin, { status: "TERLAMBAT", lateMinutes: 16, reason: "Cek ulang saja" });
  assert.deepEqual(plan, { kind: "noop", before: checkin });
});

test("TERLAMBAT -> HADIR menghapus lateMinutes; bukti check-in tidak disentuh (tidak ada di data)", () => {
  const plan = buildCorrectionPatch(checkin, { status: "HADIR", lateMinutes: null, reason: "Jam sekolah mundur" });
  assert.equal(plan.kind, "update");
  if (plan.kind !== "update") return;
  assert.deepEqual(plan.data, { status: "HADIR", lateMinutes: null, source: "ADMIN", note: "Jam sekolah mundur" });
  assert.deepEqual(plan.before, checkin);
  assert.deepEqual(plan.after, { status: "HADIR", source: "ADMIN", lateMinutes: null, note: "Jam sekolah mundur" });
});

test("hanya field yang berubah yang ditulis", () => {
  const admin: AttendanceSnapshot = { status: "TERLAMBAT", source: "ADMIN", lateMinutes: 10, note: "Koreksi awal" };
  const plan = buildCorrectionPatch(admin, { status: "TERLAMBAT", lateMinutes: 20, reason: "Koreksi awal" });
  assert.equal(plan.kind, "update");
  if (plan.kind === "update") assert.deepEqual(plan.data, { lateMinutes: 20 });
});

test("lateMinutes diabaikan (null) untuk status selain TERLAMBAT", () => {
  const plan = buildCorrectionPatch(null, { status: "ALPHA", lateMinutes: 30, reason: "Tidak hadir" });
  assert.equal(plan.kind === "create" ? plan.after.lateMinutes : "x", null);
});
