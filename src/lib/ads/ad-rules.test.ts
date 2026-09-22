import { test } from "node:test";
import assert from "node:assert/strict";
import type { AdStatus } from "@prisma/client";
import {
  deriveDisplayStatus,
  editOutcome,
  isAdRunning,
  matchesTarget,
  nextAdStatus,
  normalizeTargets,
  requiresReReview,
  scheduleViolation,
  targetKeysOf,
  type AdAction,
} from "./ad-rules";

const NOW = new Date("2026-09-21T03:00:00.000Z");
const HOUR = 3_600_000;
const DAY = 86_400_000;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

test("jadwal: akhir <= mulai, < 1 jam, > 366 hari, mulai > 365 hari ke depan ditolak", () => {
  assert.equal(scheduleViolation({ startAt: at(0), endAt: at(0) }, NOW, "draft")?.code, "AD_SCHEDULE_INVALID");
  assert.equal(scheduleViolation({ startAt: at(0), endAt: at(HOUR - 1) }, NOW, "draft")?.code, "AD_SCHEDULE_INVALID");
  assert.equal(scheduleViolation({ startAt: at(0), endAt: at(HOUR) }, NOW, "draft"), null);
  assert.equal(scheduleViolation({ startAt: at(0), endAt: at(366 * DAY) }, NOW, "draft"), null);
  assert.equal(scheduleViolation({ startAt: at(0), endAt: at(366 * DAY + 1) }, NOW, "draft")?.code, "AD_SCHEDULE_INVALID");
  assert.equal(scheduleViolation({ startAt: at(365 * DAY + 1), endAt: at(366 * DAY) }, NOW, "draft")?.code, "AD_SCHEDULE_INVALID");
});

test("jadwal submit: akhir harus di masa depan; mulai di masa lalu boleh", () => {
  assert.equal(scheduleViolation({ startAt: at(-2 * DAY), endAt: at(-1) }, NOW, "draft"), null);
  assert.equal(scheduleViolation({ startAt: at(-2 * DAY), endAt: at(0) }, NOW, "submit")?.code, "AD_SCHEDULE_INVALID");
  assert.equal(scheduleViolation({ startAt: at(-2 * DAY), endAt: at(DAY) }, NOW, "submit"), null);
});

test("target: ALL tanpa baris; cakupan lain wajib tepat satu daftar yang cocok, dedupe, format & batas", () => {
  assert.deepEqual(normalizeTargets("ALL", {}), { ok: true, rows: [] });
  assert.equal(normalizeTargets("ALL", { provinceCodes: ["32"] }).ok, false);
  assert.deepEqual(normalizeTargets("PROVINCE", { provinceCodes: ["32", "31", "32"] }), {
    ok: true, rows: [{ provinceCode: "31" }, { provinceCode: "32" }],
  });
  assert.equal(normalizeTargets("PROVINCE", { provinceCodes: [] }).ok, false);
  assert.equal(normalizeTargets("PROVINCE", { provinceCodes: ["3"] }).ok, false);
  assert.equal(normalizeTargets("PROVINCE", { cityCodes: ["32.73"] }).ok, false);
  assert.equal(normalizeTargets("PROVINCE", { provinceCodes: ["32"], cityCodes: ["32.73"] }).ok, false);
  assert.deepEqual(normalizeTargets("CITY", { cityCodes: ["32.73"] }), { ok: true, rows: [{ cityCode: "32.73" }] });
  assert.equal(normalizeTargets("CITY", { cityCodes: ["3273"] }).ok, false);
  assert.deepEqual(normalizeTargets("SCHOOL", { schoolIds: ["s1"] }), { ok: true, rows: [{ schoolId: "s1" }] });
  const many = Array.from({ length: 101 }, (_, i) => `s${i}`);
  assert.equal(normalizeTargets("SCHOOL", { schoolIds: many }).ok, false);
  const invalid = normalizeTargets("CITY", {});
  assert.equal(invalid.ok ? null : invalid.violation.code, "AD_TARGETS_INVALID");
});

test("kecocokan target dengan sekolah siswa", () => {
  const school = { id: "s1", provinceCode: "32", cityCode: "32.73" };
  assert.equal(matchesTarget("ALL", [], school), true);
  assert.equal(matchesTarget("PROVINCE", [{ provinceCode: "32", cityCode: null, schoolId: null }], school), true);
  assert.equal(matchesTarget("PROVINCE", [{ provinceCode: "31", cityCode: null, schoolId: null }], school), false);
  assert.equal(matchesTarget("CITY", [{ provinceCode: null, cityCode: "32.73", schoolId: null }], school), true);
  assert.equal(matchesTarget("CITY", [{ provinceCode: null, cityCode: "32.04", schoolId: null }], school), false);
  assert.equal(matchesTarget("SCHOOL", [{ provinceCode: null, cityCode: null, schoolId: "s1" }], school), true);
  assert.equal(matchesTarget("SCHOOL", [{ provinceCode: null, cityCode: null, schoolId: "s2" }], school), false);
  assert.equal(matchesTarget("SCHOOL", [{ provinceCode: "32", cityCode: null, schoolId: null }], school), false, "kolom tak sesuai cakupan diabaikan");
});

const TABLE: ReadonlyArray<readonly [AdStatus, AdAction, AdStatus | null]> = [
  ["DRAFT", "submit", "PENDING_REVIEW"], ["REJECTED", "submit", "PENDING_REVIEW"], ["APPROVED", "submit", null],
  ["PENDING_REVIEW", "withdraw", "DRAFT"], ["DRAFT", "withdraw", null],
  ["APPROVED", "pause", "PAUSED"], ["PAUSED", "pause", null],
  ["PAUSED", "resume", "APPROVED"], ["APPROVED", "resume", null],
  ["DRAFT", "archive", "ARCHIVED"], ["REJECTED", "archive", "ARCHIVED"], ["APPROVED", "archive", "ARCHIVED"],
  ["PAUSED", "archive", "ARCHIVED"], ["PENDING_REVIEW", "archive", null], ["ARCHIVED", "archive", null],
  ["PENDING_REVIEW", "approve", "APPROVED"], ["DRAFT", "approve", null],
  ["PENDING_REVIEW", "reject", "REJECTED"], ["APPROVED", "reject", null],
  ["APPROVED", "takedown", "REJECTED"], ["PAUSED", "takedown", "REJECTED"], ["PENDING_REVIEW", "takedown", "REJECTED"],
  ["DRAFT", "takedown", null], ["ARCHIVED", "takedown", null],
];

test("tabel transisi iklan", () => {
  for (const [from, action, to] of TABLE) assert.equal(nextAdStatus(from, action), to, `${from} --${action}-->`);
});

test("hasil edit: PENDING_REVIEW terkunci, ARCHIVED terkunci, konten aktif -> review ulang", () => {
  assert.equal(editOutcome("DRAFT", true), "SAME");
  assert.equal(editOutcome("REJECTED", true), "SAME");
  assert.equal(editOutcome("APPROVED", false), "SAME");
  assert.equal(editOutcome("APPROVED", true), "REREVIEW");
  assert.equal(editOutcome("PAUSED", true), "REREVIEW");
  assert.equal(editOutcome("PENDING_REVIEW", false), "LOCKED_PENDING");
  assert.equal(editOutcome("ARCHIVED", false), "LOCKED");
});

test("review ulang hanya untuk gambar, tautan, tipe tautan, cakupan, atau himpunan target", () => {
  const base = { imageFileId: "f1", targetUrl: "https://a.co/", linkType: "EXTERNAL_URL" as const, targetScope: "PROVINCE" as const, targetKeys: ["p:31", "p:32"] };
  assert.equal(requiresReReview(base, { ...base }), false);
  assert.equal(requiresReReview(base, { ...base, targetKeys: ["p:32", "p:31"] }), false, "urutan target diabaikan");
  assert.equal(requiresReReview(base, { ...base, imageFileId: "f2" }), true);
  assert.equal(requiresReReview(base, { ...base, targetUrl: "https://b.co/" }), true);
  assert.equal(requiresReReview(base, { ...base, linkType: "DEEP_LINK" }), true);
  assert.equal(requiresReReview(base, { ...base, targetScope: "ALL", targetKeys: [] }), true);
  assert.equal(requiresReReview(base, { ...base, targetKeys: ["p:31"] }), true);
  assert.deepEqual(targetKeysOf([{ provinceCode: "32", cityCode: null, schoolId: null }, { provinceCode: null, cityCode: "32.73", schoolId: null }]), ["c:32.73", "p:32"]);
});

const liveAd = { status: "APPROVED" as AdStatus, startAt: at(-DAY), endAt: at(DAY), cpcAmount: 500 };
const okSponsor = { status: "APPROVED" as const, balance: 500 };

test("status tampilan turunan & batasnya", () => {
  assert.equal(deriveDisplayStatus(liveAd, okSponsor, NOW), "LIVE", "saldo == CPC tetap LIVE");
  assert.equal(deriveDisplayStatus(liveAd, { ...okSponsor, balance: 499 }, NOW), "NO_BALANCE");
  assert.equal(deriveDisplayStatus({ ...liveAd, startAt: NOW }, okSponsor, NOW), "LIVE", "startAt == now = LIVE");
  assert.equal(deriveDisplayStatus({ ...liveAd, endAt: NOW }, okSponsor, NOW), "ENDED", "endAt == now = ENDED");
  assert.equal(deriveDisplayStatus({ ...liveAd, status: "PAUSED", endAt: at(-1) }, okSponsor, NOW), "ENDED", "ENDED mendahului PAUSED");
  assert.equal(deriveDisplayStatus({ ...liveAd, status: "PAUSED" }, okSponsor, NOW), "PAUSED");
  assert.equal(deriveDisplayStatus(liveAd, { ...okSponsor, status: "SUSPENDED" }, NOW), "SPONSOR_INACTIVE");
  assert.equal(deriveDisplayStatus({ ...liveAd, startAt: at(1) }, okSponsor, NOW), "SCHEDULED");
  for (const status of ["DRAFT", "PENDING_REVIEW", "REJECTED", "ARCHIVED"] as const) {
    assert.equal(deriveDisplayStatus({ ...liveAd, status, endAt: at(-1) }, okSponsor, NOW), status);
  }
});

test("iklan berjalan: disetujui, dalam jadwal, sponsor APPROVED (saldo dinilai terpisah)", () => {
  assert.equal(isAdRunning(liveAd, "APPROVED", NOW), true);
  assert.equal(isAdRunning(liveAd, "SUSPENDED", NOW), false);
  assert.equal(isAdRunning({ ...liveAd, status: "PAUSED" }, "APPROVED", NOW), false);
  assert.equal(isAdRunning({ ...liveAd, endAt: NOW }, "APPROVED", NOW), false);
  assert.equal(isAdRunning({ ...liveAd, startAt: at(1) }, "APPROVED", NOW), false);
});
