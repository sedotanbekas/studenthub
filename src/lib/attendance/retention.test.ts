import { test } from "node:test";
import assert from "node:assert/strict";
import { hasTimeLeft, orphanFileCutoff, retentionCutoffs, SELFIE_RETENTION_DAYS } from "./retention";

const NOW = new Date("2026-09-21T19:00:00.000Z");
const daysBefore = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

test("tenggat retensi dihitung dari now (keputusan klien: selfie 180 hari)", () => {
  assert.equal(SELFIE_RETENTION_DAYS, 180);
  const c = retentionCutoffs(NOW);
  assert.equal(c.selfie.toISOString(), daysBefore(180));
  assert.equal(c.rejectedLeaveAttachment.toISOString(), daysBefore(30));
  assert.equal(c.rejection.toISOString(), daysBefore(90));
  assert.equal(c.rotatedRefreshToken.toISOString(), daysBefore(30));
  assert.equal(c.expiredRefreshToken.toISOString(), daysBefore(1));
  assert.equal(c.deadSession.toISOString(), daysBefore(90));
  assert.equal(c.notification.toISOString(), daysBefore(365));
  assert.equal(c.jobRun.toISOString(), daysBefore(90));
  assert.equal(c.autoAlphaRun.toISOString(), daysBefore(400));
});

test("banner yatim: dibuat lebih dari 24 jam lalu", () => {
  assert.equal(orphanFileCutoff(NOW).toISOString(), "2026-09-20T19:00:00.000Z");
});

test("hasTimeLeft membandingkan jam dinding dengan deadline", () => {
  assert.equal(hasTimeLeft(1_000, () => 999), true);
  assert.equal(hasTimeLeft(1_000, () => 1_000), false);
});
