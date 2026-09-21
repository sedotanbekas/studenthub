import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { dHash, hammingDistance, NEAR_DUPLICATE_MAX_DISTANCE } from "./phash";

/** Gambar uji bergradasi dengan beberapa bentuk agar dHash punya struktur (bukan warna rata). */
async function scene(options: { brighten?: number; flipShapes?: boolean } = {}): Promise<Buffer> {
  const w = 320;
  const h = 240;
  const shapes = options.flipShapes
    ? `<rect x="200" y="20" width="100" height="80" fill="#111"/><circle cx="80" cy="170" r="50" fill="#eee"/>`
    : `<rect x="20" y="20" width="100" height="80" fill="#111"/><circle cx="240" cy="170" r="50" fill="#eee"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#204060"/><stop offset="1" stop-color="#c0d0e0"/></linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>${shapes}</svg>`;
  const base = sharp(Buffer.from(svg)).removeAlpha();
  const adjusted = options.brighten ? base.modulate({ brightness: options.brighten }) : base;
  return adjusted.jpeg({ quality: 90 }).toBuffer();
}

test("dHash: 16 karakter hex, deterministik untuk gambar sama", async () => {
  const img = await scene();
  const a = await dHash(img);
  const b = await dHash(img);
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.equal(a, b);
  assert.equal(hammingDistance(a, b), 0);
});

test("dHash: salinan sedikit dicerahkan / di-re-encode tetap dekat", async () => {
  const original = await dHash(await scene());
  const brighter = await dHash(await scene({ brighten: 1.08 }));
  const resized = await dHash(await sharp(await scene()).resize(160).webp({ quality: 60 }).toBuffer());
  assert.ok(hammingDistance(original, brighter) <= NEAR_DUPLICATE_MAX_DISTANCE, `brighter ${hammingDistance(original, brighter)}`);
  assert.ok(hammingDistance(original, resized) <= NEAR_DUPLICATE_MAX_DISTANCE, `resized ${hammingDistance(original, resized)}`);
});

test("dHash: gambar berbeda jauh", async () => {
  const a = await dHash(await scene());
  const b = await dHash(await scene({ flipShapes: true }));
  assert.ok(hammingDistance(a, b) > NEAR_DUPLICATE_MAX_DISTANCE, `distance ${hammingDistance(a, b)}`);
});

test("dHash: gambar beralfa tetap menghasilkan hash (flatten)", async () => {
  const png = await sharp({ create: { width: 50, height: 30, channels: 4, background: { r: 10, g: 200, b: 30, alpha: 0.5 } } }).png().toBuffer();
  assert.match(await dHash(png), /^[0-9a-f]{16}$/);
});

test("hammingDistance: hitung bit berbeda & tolak input cacat", () => {
  assert.equal(hammingDistance("0000000000000000", "0000000000000000"), 0);
  assert.equal(hammingDistance("0000000000000000", "ffffffffffffffff"), 64);
  assert.equal(hammingDistance("0000000000000001", "0000000000000003"), 1);
  assert.equal(hammingDistance("f0f0f0f0f0f0f0f0", "0f0f0f0f0f0f0f0f"), 64);
  assert.equal(hammingDistance("ABCDEF0123456789", "abcdef0123456789"), 0);
  assert.equal(NEAR_DUPLICATE_MAX_DISTANCE, 6);
  assert.throws(() => hammingDistance("123", "0000000000000000"), RangeError);
  assert.throws(() => hammingDistance("zzzzzzzzzzzzzzzz", "0000000000000000"), RangeError);
});
