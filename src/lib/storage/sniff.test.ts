import { test } from "node:test";
import assert from "node:assert/strict";
import sharp, { type Sharp } from "sharp";
import { isAppError } from "@/lib/http/errors";
import { assertAllowedImage, sniffImage } from "./sniff";

function solid(): Sharp {
  return sharp({ create: { width: 8, height: 8, channels: 3, background: "#3366cc" } });
}

/** Header ISO-BMFF minimal: box ftyp dengan brand utama tertentu. */
function ftyp(brand: string): Uint8Array {
  const header = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from("ftyp", "latin1"),
    Buffer.from(brand, "latin1"),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    Buffer.from(`mif1${brand}`, "latin1"),
  ]);
  return new Uint8Array(Buffer.concat([header, Buffer.alloc(64)]));
}

test("sniffImage: JPEG, PNG, WebP dari magic bytes", async () => {
  assert.equal(await sniffImage(await solid().jpeg().toBuffer()), "jpeg");
  assert.equal(await sniffImage(await solid().png().toBuffer()), "png");
  assert.equal(await sniffImage(await solid().webp().toBuffer()), "webp");
});

test("sniffImage: HEIC/HEIF sintetis dikenali sebagai heic", async () => {
  assert.equal(await sniffImage(ftyp("heic")), "heic");
  assert.equal(await sniffImage(ftyp("heix")), "heic");
  assert.equal(await sniffImage(ftyp("mif1")), "heic");
});

test("sniffImage: selain itu unknown (kosong, teks, PDF, GIF, SVG, AVIF, ZIP)", async () => {
  assert.equal(await sniffImage(new Uint8Array(0)), "unknown");
  assert.equal(await sniffImage(Buffer.from("halo dunia, ini bukan gambar")), "unknown");
  assert.equal(await sniffImage(Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n")), "unknown");
  assert.equal(await sniffImage(await solid().gif().toBuffer()), "unknown");
  assert.equal(await sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), "unknown");
  assert.equal(await sniffImage(ftyp("avif")), "unknown");
  assert.equal(await sniffImage(Buffer.from([0x50, 0x4b, 0x03, 0x04, ...Buffer.alloc(40)])), "unknown");
});

test("sniffImage: ekstensi/klaim klien tidak berpengaruh — HTML berawalan tag bukan gambar", async () => {
  assert.equal(await sniffImage(Buffer.from("<!DOCTYPE html><html><body>x</body></html>")), "unknown");
});

test("assertAllowedImage: jpeg/png/webp lolos", () => {
  for (const t of ["jpeg", "png", "webp"] as const) assert.doesNotThrow(() => assertAllowedImage(t));
});

test("assertAllowedImage: heic → 415 HEIC_NOT_SUPPORTED, unknown → 415 UNSUPPORTED_MEDIA_TYPE", () => {
  assert.throws(
    () => assertAllowedImage("heic"),
    (err: unknown) => isAppError(err) && err.status === 415 && err.code === "HEIC_NOT_SUPPORTED"
      && err.message === "Format HEIC tidak didukung. Gunakan JPEG/PNG.",
  );
  assert.throws(
    () => assertAllowedImage("unknown"),
    (err: unknown) => isAppError(err) && err.status === 415 && err.code === "UNSUPPORTED_MEDIA_TYPE"
      && err.message === "Unggah foto JPEG, PNG, atau WebP.",
  );
});
