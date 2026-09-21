import { test } from "node:test";
import assert from "node:assert/strict";
import { downloadFilename, sanitizeOriginalName } from "./names";

test("sanitizeOriginalName: hanya basename (POSIX & Windows)", () => {
  assert.equal(sanitizeOriginalName("/home/siswa/foto.jpg"), "foto.jpg");
  assert.equal(sanitizeOriginalName("C:\\Users\\Siswa\\Desktop\\bukti bayar.png"), "bukti bayar.png");
  assert.equal(sanitizeOriginalName("../../etc/passwd"), "passwd");
  assert.equal(sanitizeOriginalName("..\\..\\boot.ini"), "boot.ini");
});

test("sanitizeOriginalName: buang karakter kontrol, bidi, NUL dan spasi tepi", () => {
  assert.equal(sanitizeOriginalName("  foto\u0000\u0007\r\n.jpg  "), "foto.jpg");
  assert.equal(sanitizeOriginalName("tagihan\u202egpj.exe"), "tagihangpj.exe");
  assert.equal(sanitizeOriginalName("a\u007fb\u0085c.png"), "abc.png");
});

test("sanitizeOriginalName: kosong/titik → null; maksimal 255 code point tanpa memotong emoji", () => {
  assert.equal(sanitizeOriginalName(""), null);
  assert.equal(sanitizeOriginalName("   "), null);
  assert.equal(sanitizeOriginalName("."), null);
  assert.equal(sanitizeOriginalName(".."), null);
  assert.equal(sanitizeOriginalName("dir/"), null);
  assert.equal(sanitizeOriginalName(null), null);
  assert.equal(sanitizeOriginalName(undefined), null);
  const long = sanitizeOriginalName(`${"a".repeat(300)}.jpg`);
  assert.equal(long?.length, 255);
  const emoji = sanitizeOriginalName(`${"a".repeat(254)}😀😀`);
  assert.equal(emoji, `${"a".repeat(254)}😀`);
  assert.equal(sanitizeOriginalName("Kuitansi SPP — Sept.jpg"), "Kuitansi SPP — Sept.jpg");
});

test("downloadFilename: <kind-kebab>-<id>.<ext>", () => {
  assert.equal(downloadFilename("ATTENDANCE_SELFIE", "clx123", "image/jpeg"), "attendance-selfie-clx123.jpg");
  assert.equal(downloadFilename("AD_BANNER", "clx9", "image/webp"), "ad-banner-clx9.webp");
  assert.equal(downloadFilename("TOPUP_PROOF", "a/b", "image/jpeg"), "topup-proof-ab.jpg");
  assert.equal(downloadFilename("PAYMENT_PROOF", "x", "application/octet-stream"), "payment-proof-x.bin");
});
