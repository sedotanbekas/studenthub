import { test } from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { signAdToken, verifyAdToken, type AdTokenClaims } from "./token";

const KEY = "ad-event-secret-unit-test-0123456789abcdef";
const OTHER = "access-secret-unit-test-0123456789abcdefgh";
const NOW = new Date("2026-09-21T03:00:00.000Z");
const CLAIMS: AdTokenClaims = { adId: "ad1", sponsorId: "sp1", userId: "u1", schoolId: "s1" };
const later = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);

test("token pulang-pergi dan terikat klaim", async () => {
  const token = await signAdToken(CLAIMS, KEY, NOW);
  assert.deepEqual(await verifyAdToken(token, KEY, later(60)), CLAIMS);
});

test("kedaluwarsa setelah 6 jam", async () => {
  const token = await signAdToken(CLAIMS, KEY, NOW);
  assert.deepEqual(await verifyAdToken(token, KEY, later(21_599)), CLAIMS);
  assert.equal(await verifyAdToken(token, KEY, later(21_601)), null);
});

test("payload diubah, rahasia lain, atau token akses (aud berbeda) ditolak", async () => {
  const token = await signAdToken(CLAIMS, KEY, NOW);
  const [h, p, s] = token.split(".");
  const payload = JSON.parse(Buffer.from(p ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
  const forged = `${h}.${Buffer.from(JSON.stringify({ ...payload, u: "u2" })).toString("base64url")}.${s}`;
  assert.equal(await verifyAdToken(forged, KEY, NOW), null);
  assert.equal(await verifyAdToken(token, OTHER, NOW), null);
  const access = await new SignJWT({ sid: "x" }).setProtectedHeader({ alg: "HS256" }).setSubject("u1").setIssuedAt().setExpirationTime("15m").sign(new TextEncoder().encode(KEY));
  assert.equal(await verifyAdToken(access, KEY, NOW), null);
  assert.equal(await verifyAdToken("bukan.token.jwt", KEY, NOW), null);
});

test("klaim wajib hilang atau salah tipe ditolak", async () => {
  const secret = new TextEncoder().encode(KEY);
  const partial = await new SignJWT({ v: 1, a: "ad1", sp: "sp1", u: "u1" })
    .setProtectedHeader({ alg: "HS256" }).setAudience("sh-ad-event").setIssuer("studenthub").setIssuedAt(NOW).setExpirationTime(later(60)).sign(secret);
  assert.equal(await verifyAdToken(partial, KEY, NOW), null);
  const wrongType = await new SignJWT({ v: 1, a: 5, sp: "sp1", u: "u1", sc: "s1" })
    .setProtectedHeader({ alg: "HS256" }).setAudience("sh-ad-event").setIssuer("studenthub").setIssuedAt(NOW).setExpirationTime(later(60)).sign(secret);
  assert.equal(await verifyAdToken(wrongType, KEY, NOW), null);
});
