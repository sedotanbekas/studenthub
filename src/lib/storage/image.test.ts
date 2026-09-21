import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import sharp, { type Sharp } from "sharp";
import { isAppError, type AppError } from "@/lib/http/errors";
import { processImage } from "./image";

const MIB = 1024 * 1024;

function solid(width: number, height: number, background = "#3366cc"): Sharp {
  return sharp({ create: { width, height, channels: 3, background } });
}

async function rejectsWith(p: Promise<unknown>, status: number, code: string): Promise<AppError> {
  let caught: unknown;
  await assert.rejects(p, (err: unknown) => {
    caught = err;
    return isAppError(err) && err.status === status && err.code === code;
  });
  return caught as AppError;
}

test("selfie: di-resize ke dalam 640, JPEG, metadata EXIF/GPS dibuang, sha256 & dHash atas output", async () => {
  const input = await solid(1600, 1200)
    .withExif({ IFD0: { Copyright: "RAHASIA-EXIF-UJI" }, IFD3: { GPSLatitudeRef: "S", GPSLatitude: "6/1 10/1 0/1" } })
    .jpeg({ quality: 95 })
    .toBuffer();
  const inMeta = await sharp(input).metadata();
  assert.ok(inMeta.exif && inMeta.exif.length > 0);
  assert.ok(input.includes("RAHASIA-EXIF-UJI"));

  const out = await processImage(input, "ATTENDANCE_SELFIE");
  assert.equal(out.mimeType, "image/jpeg");
  assert.equal(out.ext, "jpg");
  assert.equal(out.width, 640);
  assert.equal(out.height, 480);
  assert.equal(out.sizeBytes, out.data.length);
  assert.equal(out.sha256, createHash("sha256").update(out.data).digest("hex"));
  assert.match(out.phash, /^[0-9a-f]{16}$/);
  const outMeta = await sharp(out.data).metadata();
  assert.equal(outMeta.format, "jpeg");
  assert.equal(outMeta.exif, undefined);
  assert.equal(outMeta.xmp, undefined);
  assert.equal(outMeta.orientation, undefined);
  assert.ok(!out.data.includes("RAHASIA-EXIF-UJI"));
});

test("selfie: orientasi EXIF diterapkan (rotate) lalu tag dibuang", async () => {
  const input = await solid(400, 300).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const out = await processImage(input, "ATTENDANCE_SELFIE");
  assert.equal(out.width, 300);
  assert.equal(out.height, 400);
  assert.equal((await sharp(out.data).metadata()).orientation, undefined);
});

test("selfie: sisi terpendek < 240 → 422 IMAGE_TOO_SMALL; tepat 240 lolos", async () => {
  await rejectsWith(processImage(await solid(320, 239).png().toBuffer(), "ATTENDANCE_SELFIE"), 422, "IMAGE_TOO_SMALL");
  const ok = await processImage(await solid(240, 240).webp().toBuffer(), "ATTENDANCE_SELFIE");
  assert.equal(ok.width, 240);
  assert.equal(ok.height, 240);
});

test("poliglot: payload HTML/ZIP yang ditempel setelah JPEG tidak ikut tersimpan", async () => {
  const jpeg = await solid(900, 700, "#aa5500").jpeg().toBuffer();
  const html = Buffer.from("<html><script>alert(document.cookie)</script></html>");
  const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("evil.php<?php system($_GET[c]); ?>")]);
  const polyglot = Buffer.concat([jpeg, html, zip]);
  assert.ok(polyglot.includes("<script>"));
  const out = await processImage(polyglot, "PAYMENT_PROOF");
  assert.ok(!out.data.includes("<script>"));
  assert.ok(!out.data.includes("<?php"));
  assert.ok(!out.data.includes(Buffer.from([0x50, 0x4b, 0x03, 0x04])));
  assert.equal(out.mimeType, "image/jpeg");
});

test("bukti: dibatasi 2000 px, PNG beralfa diratakan ke latar putih", async () => {
  const big = await processImage(await solid(3000, 1000).png().toBuffer(), "LEAVE_ATTACHMENT");
  assert.equal(big.width, 2000);
  assert.equal(big.height, 667);
  const transparent = await sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  const out = await processImage(transparent, "TOPUP_PROOF");
  const { data } = await sharp(out.data).raw().toBuffer({ resolveWithObject: true });
  assert.ok(data[0]! > 245 && data[1]! > 245 && data[2]! > 245, "latar harus putih");
});

test("ukuran input melebihi batas jenis → 413 PAYLOAD_TOO_LARGE", async () => {
  const err = await rejectsWith(processImage(new Uint8Array(5 * MIB + 1), "ATTENDANCE_SELFIE"), 413, "PAYLOAD_TOO_LARGE");
  assert.deepEqual(err.details, { maxBytes: 5 * MIB });
  await rejectsWith(processImage(new Uint8Array(8 * MIB + 1), "PAYMENT_PROOF"), 413, "PAYLOAD_TOO_LARGE");
});

test("tipe: HEIC → 415 HEIC_NOT_SUPPORTED; GIF/teks/kosong → 415 UNSUPPORTED_MEDIA_TYPE", async () => {
  const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic", "latin1"), Buffer.alloc(80)]);
  await rejectsWith(processImage(heic, "ATTENDANCE_SELFIE"), 415, "HEIC_NOT_SUPPORTED");
  await rejectsWith(processImage(await solid(300, 300).gif().toBuffer(), "PAYMENT_PROOF"), 415, "UNSUPPORTED_MEDIA_TYPE");
  await rejectsWith(processImage(Buffer.from("bukan gambar"), "PAYMENT_PROOF"), 415, "UNSUPPORTED_MEDIA_TYPE");
  await rejectsWith(processImage(new Uint8Array(0), "PAYMENT_PROOF"), 415, "UNSUPPORTED_MEDIA_TYPE");
});

test("berkas rusak/terpotong → 422 IMAGE_UNREADABLE", async () => {
  const junk = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
  const err = await rejectsWith(processImage(junk, "PAYMENT_PROOF"), 422, "IMAGE_UNREADABLE");
  assert.equal(err.message, "Gambar tidak dapat dibaca.");
  const jpeg = await solid(400, 300).jpeg().toBuffer();
  await rejectsWith(processImage(jpeg.subarray(0, Math.floor(jpeg.length / 2)), "ATTENDANCE_SELFIE"), 422, "IMAGE_UNREADABLE");
});

test("resolusi > 25 MP: bukti → 422 IMAGE_TOO_LARGE, banner → BANNER_INVALID PIXELS", async () => {
  // 7072×3536 = 25.006.592 piksel: rasio 2:1 sah, hanya jumlah piksel yang melanggar.
  const huge = await solid(7072, 3536, "#ffffff").png({ compressionLevel: 1 }).toBuffer();
  await rejectsWith(processImage(huge, "PAYMENT_PROOF"), 422, "IMAGE_TOO_LARGE");
  const err = await rejectsWith(processImage(huge, "AD_BANNER"), 422, "BANNER_INVALID");
  assert.deepEqual(err.details, { reason: "PIXELS" });
});

test("banner: batas rasio 2:1 ±2% → WebP tepat 1200×600", async () => {
  const out = await processImage(await solid(1020, 500).png().toBuffer(), "AD_BANNER");
  assert.equal(out.mimeType, "image/webp");
  assert.equal(out.ext, "webp");
  assert.equal(out.width, 1200);
  assert.equal(out.height, 600);
  const meta = await sharp(out.data).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.width, 1200);
  assert.equal(meta.height, 600);
  const err = await rejectsWith(processImage(await solid(1021, 500).png().toBuffer(), "AD_BANNER"), 422, "BANNER_INVALID");
  assert.deepEqual(err.details, { reason: "ASPECT" });
});

test("banner: terlalu kecil dan animasi ditolak dengan alasan", async () => {
  const small = await rejectsWith(processImage(await solid(798, 399).jpeg().toBuffer(), "AD_BANNER"), 422, "BANNER_INVALID");
  assert.deepEqual(small.details, { reason: "TOO_SMALL" });
  const f1 = await solid(1000, 500, "#ff0000").png().toBuffer();
  const f2 = await solid(1000, 500, "#0000ff").png().toBuffer();
  const animated = await sharp([f1, f2], { join: { animated: true } }).webp().toBuffer();
  assert.equal((await sharp(animated).metadata()).pages, 2);
  const anim = await rejectsWith(processImage(animated, "AD_BANNER"), 422, "BANNER_INVALID");
  assert.deepEqual(anim.details, { reason: "ANIMATED" });
});

test("hasil tidak memutasi buffer input dan dapat diproses paralel", async () => {
  const input = await solid(700, 500).jpeg().toBuffer();
  const copy = Buffer.from(input);
  const results = await Promise.all(Array.from({ length: 10 }, () => processImage(input, "ATTENDANCE_SELFIE")));
  assert.ok(input.equals(copy));
  assert.equal(new Set(results.map((r) => r.sha256)).size, 1);
});
