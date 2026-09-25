import { test } from "node:test";
import assert from "node:assert/strict";
import { SLIDE_STALE_MS, isPlainClick, linkDirection, slideMode, traverseDirection, type SlideCapture } from "./page-slide-rules";

const capture = (over: Partial<SlideCapture> = {}): SlideCapture => ({ dir: "forward", from: "/hub", at: 1000, mobile: true, ...over });

test("slideMode: animasi hanya bila halaman benar-benar berganti dan tangkapan masih baru", () => {
  assert.equal(slideMode(null, "/hub/my-reports", 1100), null);
  assert.equal(slideMode(capture(), "/hub/my-reports", 1100), "forward");
  assert.equal(slideMode(capture({ dir: "back" }), "/hub/my-reports", 1100), "back");
  assert.equal(slideMode(capture(), "/hub", 1100), null, "tautan ke halaman yang sama tidak beranimasi");
  assert.equal(slideMode(capture(), "/hub/my-reports", 1000 + SLIDE_STALE_MS + 1), null, "tangkapan basi diabaikan");
  assert.equal(slideMode(capture({ mobile: false }), "/hub/my-reports", 1100), "fade", "layar lebar: pudar halus");
});

test("linkDirection: ke beranda = kembali, selain itu masuk halaman", () => {
  assert.equal(linkDirection("/hub"), "back");
  assert.equal(linkDirection("/hub/"), "back");
  assert.equal(linkDirection("/hub/my-reports"), "forward");
  assert.equal(linkDirection("/hub/my-attendance?absen=1"), "forward");
});

test("traverseDirection: indeks tujuan lebih besar = maju; tanpa info = kembali", () => {
  assert.equal(traverseDirection(3, 4), "back");
  assert.equal(traverseDirection(5, 4), "forward");
  assert.equal(traverseDirection(undefined, 4), "back");
  assert.equal(traverseDirection(2, undefined), "back");
});

test("isPlainClick: klik kiri biasa saja; tab baru/modifier/klik yang dibatalkan tidak dianimasikan", () => {
  const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
  assert.equal(isPlainClick(click), true);
  assert.equal(isPlainClick({ ...click, metaKey: true }), false);
  assert.equal(isPlainClick({ ...click, ctrlKey: true }), false);
  assert.equal(isPlainClick({ ...click, shiftKey: true }), false);
  assert.equal(isPlainClick({ ...click, altKey: true }), false);
  assert.equal(isPlainClick({ ...click, button: 1 }), false);
  assert.equal(isPlainClick({ ...click, defaultPrevented: true }), false);
});
