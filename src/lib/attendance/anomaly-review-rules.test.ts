import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRange } from "./attendance-stats";
import {
  ANOMALY_REVIEW_DECISIONS,
  ANOMALY_REVIEW_FILTERS,
  PENDING_ANOMALY_REVIEW_WHERE,
  UNREVIEWED_DEFAULT_RANGE_DAYS,
  anomalyQueueDefaultDays,
  invalidBlockedByWindow,
  needsAnomalyReview,
  normalizeReviewNote,
  planAnomalyReview,
  reopensOnNewFlag,
  reviewNoteProblem,
  reviewViolationStatus,
  sameFlagSet,
} from "./anomaly-review-rules";
import { validateCorrection } from "./correction-rules";

test("konstanta: keputusan, filter, definisi tunggal 'perlu ditinjau'", () => {
  assert.deepEqual([...ANOMALY_REVIEW_DECISIONS], ["VALID", "INVALID"]);
  assert.deepEqual([...ANOMALY_REVIEW_FILTERS], ["UNREVIEWED", "VALID", "INVALID", "ALL_ANOMALIES"]);
  assert.deepEqual(PENDING_ANOMALY_REVIEW_WHERE, { hasAnomaly: true, anomalyReviewedAt: null });
});

test("needsAnomalyReview: hanya beranomali yang belum ditinjau", () => {
  assert.equal(needsAnomalyReview({ hasAnomaly: true, anomalyReviewedAt: null }), true);
  assert.equal(needsAnomalyReview({ hasAnomaly: true, anomalyReviewedAt: new Date() }), false);
  assert.equal(needsAnomalyReview({ hasAnomaly: false, anomalyReviewedAt: null }), false);
});

test("normalizeReviewNote & reviewNoteProblem: Tidak valid wajib alasan (dikirim ke siswa); Valid opsional", () => {
  assert.equal(normalizeReviewNote("  "), null);
  assert.equal(normalizeReviewNote(" Foto "), "Foto");
  assert.equal(normalizeReviewNote(undefined), null);
  assert.equal(reviewNoteProblem("INVALID", null), "Tulis alasan minimal 5 karakter — alasan ini dikirim ke siswa.");
  assert.equal(reviewNoteProblem("INVALID", "abcd"), "Tulis alasan minimal 5 karakter — alasan ini dikirim ke siswa.");
  assert.match(reviewNoteProblem("INVALID", "x".repeat(256)) ?? "", /maksimal 255/);
  assert.equal(reviewNoteProblem("INVALID", "Foto bukan wajah siswa"), null);
  assert.equal(reviewNoteProblem("VALID", null), null);
  assert.equal(reviewNoteProblem("VALID", "  "), null);
  assert.equal(reviewNoteProblem("VALID", "ok"), "Catatan minimal 5 karakter, atau kosongkan.");
});

test("planAnomalyReview: tanpa anomali dicek dulu; transisi yang diizinkan", () => {
  assert.equal(planAnomalyReview({ hasAnomaly: false, decision: null }, "VALID").kind, "violation");
  const none = planAnomalyReview({ hasAnomaly: false, decision: "VALID" }, "INVALID");
  assert.equal(none.kind === "violation" && none.violation.code, "NO_ANOMALY");
  assert.deepEqual(planAnomalyReview({ hasAnomaly: true, decision: null }, "VALID"), { kind: "mark" });
  assert.deepEqual(planAnomalyReview({ hasAnomaly: true, decision: null }, "INVALID"), { kind: "invalidate" });
  assert.deepEqual(planAnomalyReview({ hasAnomaly: true, decision: "VALID" }, "VALID"), { kind: "unchanged" });
  assert.deepEqual(planAnomalyReview({ hasAnomaly: true, decision: "VALID" }, "INVALID"), { kind: "invalidate" });
  assert.deepEqual(planAnomalyReview({ hasAnomaly: true, decision: "INVALID" }, "INVALID"), { kind: "unchanged" });
  const back = planAnomalyReview({ hasAnomaly: true, decision: "INVALID" }, "VALID");
  assert.equal(back.kind === "violation" && back.violation.code, "ANOMALY_ALREADY_INVALID");
});

test("reviewViolationStatus: ANOMALY_ALREADY_INVALID & ANOMALY_FLAGS_CHANGED = 409, selain itu 422", () => {
  assert.equal(reviewViolationStatus("ANOMALY_ALREADY_INVALID"), 409);
  assert.equal(reviewViolationStatus("ANOMALY_FLAGS_CHANGED"), 409);
  assert.equal(reviewViolationStatus("NO_ANOMALY"), 422);
  assert.equal(reviewViolationStatus("CORRECTION_WINDOW_EXPIRED"), 422);
});

test("reopensOnNewFlag: hanya VALID dibuka lagi", () => {
  assert.equal(reopensOnNewFlag("VALID"), true);
  assert.equal(reopensOnNewFlag("INVALID"), false);
  assert.equal(reopensOnNewFlag(null), false);
});

test("sameFlagSet: urutan & duplikat diabaikan; flag baru/hilang = berubah", () => {
  assert.equal(sameFlagSet(["SHARED_DEVICE", "NEW_DEVICE"], ["NEW_DEVICE", "SHARED_DEVICE"]), true);
  assert.equal(sameFlagSet(["NEW_DEVICE"], ["NEW_DEVICE", "SHARED_DEVICE"]), false);
  assert.equal(sameFlagSet(["NEW_DEVICE", "SHARED_DEVICE"], ["NEW_DEVICE"]), false);
  assert.equal(sameFlagSet([], []), true);
  assert.equal(sameFlagSet(["NEW_DEVICE"], ["NEW_DEVICE", "NEW_DEVICE"]), true);
});

test("rentang default antrean: belum ditinjau = jendela koreksi (45 hari ke belakang + hari ini), lainnya 7 hari", () => {
  assert.equal(anomalyQueueDefaultDays("UNREVIEWED"), UNREVIEWED_DEFAULT_RANGE_DAYS);
  for (const filter of ["VALID", "INVALID", "ALL_ANOMALIES"] as const) assert.equal(anomalyQueueDefaultDays(filter), 7);
  const today = "2026-10-03";
  const range = resolveRange(undefined, undefined, today, anomalyQueueDefaultDays("UNREVIEWED"));
  const oldestInvalidable = range?.from ?? "";
  assert.equal(validateCorrection({ date: oldestInvalidable, today, isSchoolDay: true, windowLimited: true }), null, "tanggal tertua di antrean masih bisa Tidak valid");
  assert.equal(validateCorrection({ date: "2026-08-18", today, isSchoolDay: true, windowLimited: true })?.code, "CORRECTION_WINDOW_EXPIRED");
  assert.equal(oldestInvalidable, "2026-08-19");
});

test("invalidBlockedByWindow: admin sekolah > 45 hari tidak bisa Tidak valid; super admin bisa", () => {
  assert.equal(invalidBlockedByWindow({ date: "2026-08-19", today: "2026-10-03", windowLimited: true }), false);
  assert.equal(invalidBlockedByWindow({ date: "2026-08-18", today: "2026-10-03", windowLimited: true }), true);
  assert.equal(invalidBlockedByWindow({ date: "2026-08-18", today: "2026-10-03", windowLimited: false }), false);
});
