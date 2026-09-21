import { test } from "node:test";
import assert from "node:assert/strict";
import { REFRESH_RACE_GRACE_MS } from "./constants";
import {
  decideRefresh,
  generateRefreshToken,
  hashRefreshToken,
  platformClassOf,
  refreshExpiry,
  sessionExpiry,
} from "./refresh-rules";

const NOW = new Date("2026-09-21T03:00:00.000Z");
const at = (offsetMs: number): Date => new Date(NOW.getTime() + offsetMs);
const liveSession = { revokedAt: null, expiresAt: at(86_400_000) };
const freshToken = { rotatedAt: null, expiresAt: at(3_600_000) };

test("token segar pada sesi hidup -> ROTATE", () => {
  assert.equal(decideRefresh(freshToken, liveSession, NOW), "ROTATE");
});

test("sesi dicabut -> REVOKED (meski token segar atau sudah dirotasi)", () => {
  assert.equal(decideRefresh(freshToken, { ...liveSession, revokedAt: at(-1000) }, NOW), "REVOKED");
  assert.equal(decideRefresh({ ...freshToken, rotatedAt: at(-60_000) }, { ...liveSession, revokedAt: at(-1000) }, NOW), "REVOKED");
});

test("token kedaluwarsa atau sesi melewati batas absolut -> EXPIRED", () => {
  assert.equal(decideRefresh({ ...freshToken, expiresAt: at(-1) }, liveSession, NOW), "EXPIRED");
  assert.equal(decideRefresh({ ...freshToken, expiresAt: NOW }, liveSession, NOW), "EXPIRED");
  assert.equal(decideRefresh(freshToken, { ...liveSession, expiresAt: NOW }, NOW), "EXPIRED");
});

test("dirotasi 29,9 s lalu -> RACE; tepat di batas grace -> RACE", () => {
  assert.equal(decideRefresh({ ...freshToken, rotatedAt: at(-29_900) }, liveSession, NOW), "RACE");
  assert.equal(decideRefresh({ ...freshToken, rotatedAt: at(-REFRESH_RACE_GRACE_MS) }, liveSession, NOW), "RACE");
});

test("dirotasi lebih lama dari grace -> REUSE (juga bila token sudah kedaluwarsa)", () => {
  assert.equal(decideRefresh({ ...freshToken, rotatedAt: at(-REFRESH_RACE_GRACE_MS - 1) }, liveSession, NOW), "REUSE");
  assert.equal(decideRefresh({ rotatedAt: at(-40 * 86_400_000), expiresAt: at(-86_400_000) }, liveSession, NOW), "REUSE");
});

test("platformClassOf: ANDROID/IOS = MOBILE, WEB = WEB", () => {
  assert.equal(platformClassOf("ANDROID"), "MOBILE");
  assert.equal(platformClassOf("IOS"), "MOBILE");
  assert.equal(platformClassOf("WEB"), "WEB");
});

test("sessionExpiry: mobile 180 hari, web 7 hari", () => {
  assert.equal(sessionExpiry(NOW, "ANDROID").getTime() - NOW.getTime(), 180 * 86_400_000);
  assert.equal(sessionExpiry(NOW, "WEB").getTime() - NOW.getTime(), 7 * 86_400_000);
});

test("refreshExpiry: idle mobile 30 hari / web 12 jam, dipotong batas absolut sesi", () => {
  const far = at(365 * 86_400_000);
  assert.equal(refreshExpiry(NOW, "IOS", far).getTime() - NOW.getTime(), 30 * 86_400_000);
  assert.equal(refreshExpiry(NOW, "WEB", far).getTime() - NOW.getTime(), 12 * 3_600_000);
  const soon = at(3_600_000);
  assert.equal(refreshExpiry(NOW, "ANDROID", soon).getTime(), soon.getTime());
});

test("generateRefreshToken: 32 byte base64url + hash sha256 hex yang cocok", () => {
  const fixed = (size: number): Uint8Array => new Uint8Array(size).fill(7);
  const token = generateRefreshToken(fixed);
  assert.match(token.raw, /^[A-Za-z0-9_-]{43}$/);
  assert.match(token.hash, /^[0-9a-f]{64}$/);
  assert.equal(token.hash, hashRefreshToken(token.raw));
  assert.notEqual(generateRefreshToken().raw, generateRefreshToken().raw);
});
