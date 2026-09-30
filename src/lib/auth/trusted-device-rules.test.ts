import { test } from "node:test";
import assert from "node:assert/strict";
import { trustAccepted } from "./trusted-device-rules";

const now = new Date("2026-09-30T08:00:00.000Z");
const later = new Date("2026-10-30T08:00:00.000Z");

test("perangkat tepercaya: hanya pemilik token, sebelum kedaluwarsa", () => {
  assert.equal(trustAccepted({ userId: "u1", expiresAt: later }, "u1", now), true);
  assert.equal(trustAccepted({ userId: "u2", expiresAt: later }, "u1", now), false);
  assert.equal(trustAccepted({ userId: "u1", expiresAt: now }, "u1", now), false);
  assert.equal(trustAccepted(null, "u1", now), false);
});
