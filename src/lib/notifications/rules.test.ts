import { test } from "node:test";
import assert from "node:assert/strict";
import { initialPushStatus, previewText, resolveCategory } from "./rules";

test("resolveCategory memakai peta tipe atau kategori eksplisit untuk pengumuman", () => {
  assert.equal(resolveCategory("PAYMENT_APPROVED"), "FINANCE");
  assert.equal(resolveCategory("ANNOUNCEMENT", "EVENT"), "EVENT");
  assert.throws(() => resolveCategory("ANNOUNCEMENT"));
});

test("push hanya untuk siswa", () => {
  assert.equal(initialPushStatus("STUDENT"), "PENDING");
  assert.equal(initialPushStatus("SCHOOL_ADMIN"), "SKIPPED");
});

test("previewText merapikan spasi dan memotong di batas kata", () => {
  assert.equal(previewText("  halo\n\n dunia  "), "halo dunia");
  const long = "kata ".repeat(200);
  const out = previewText(long, 50);
  assert.ok(Array.from(out).length <= 50);
  assert.ok(out.endsWith("…"));
  const emoji = "\u{1F600}".repeat(60);
  assert.equal(Array.from(previewText(emoji, 10)).length, 10);
});
