import { test } from "node:test";
import assert from "node:assert/strict";
import { PUBLIC_MEDIA_HEADERS, publicMediaKey } from "./public-media";

const ID = "AbCdEfGhIjKlMnOpQrStUv";

test("publicMediaKey: salinan publik banner iklan -> kunci & tipe konten", () => {
  assert.deepEqual(publicMediaKey(["ad-banner", "2026", "09", `${ID}.webp`]), { key: `public/ad-banner/2026/09/${ID}.webp`, contentType: "image/webp" });
  assert.equal(publicMediaKey(["ad-banner", "2026", "09", `${ID}.jpg`])?.contentType, "image/jpeg");
});

test("publicMediaKey: jenis privat, traversal, dan nama asing ditolak", () => {
  assert.equal(publicMediaKey(["attendance-selfie", "2026", "09", `${ID}.jpg`]), null, "selfie tidak pernah publik");
  assert.equal(publicMediaKey(["..", "private", "ad-banner", "2026", "09", `${ID}.webp`]), null);
  assert.equal(publicMediaKey(["ad-banner", "2026", "09", `${ID}.png`]), null);
  assert.equal(publicMediaKey(["ad-banner", "2026", "13", `${ID}.webp`]), null);
  assert.equal(publicMediaKey([]), null);
});

test("header media publik: cache panjang, nosniff, dan sandbox", () => {
  assert.match(PUBLIC_MEDIA_HEADERS["Cache-Control"], /immutable/);
  assert.equal(PUBLIC_MEDIA_HEADERS["X-Content-Type-Options"], "nosniff");
  assert.match(PUBLIC_MEDIA_HEADERS["Content-Security-Policy"], /sandbox/);
});
