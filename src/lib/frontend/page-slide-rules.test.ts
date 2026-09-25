import { test } from "node:test";
import assert from "node:assert/strict";
import { SLIDE_STALE_MS, isPlainClick, linkDirection, rememberStep, slideMode, tabDirection, tabPosition, traverseDirection, traverseKind, type SlideCapture } from "./page-slide-rules";

const capture = (over: Partial<SlideCapture> = {}): SlideCapture => ({ dir: "forward", kind: "push", from: "/hub", at: 1000, mobile: true, ...over });
/** Bottom nav siswa: Beranda, Absensi, Rapor, Tagihan (+ tombol Menu di paling kanan). */
const TABS = ["/hub", "/hub/my-attendance", "/hub/my-reports", "/hub/my-billing"];

test("slideMode: pindah tab bottom nav = geser bersebelahan searah posisi tab; layar lebar tetap pudar", () => {
  assert.equal(slideMode(capture({ kind: "tab" }), "/hub/my-reports", 1100), "tab-forward");
  assert.equal(slideMode(capture({ kind: "tab", dir: "back" }), "/hub/my-reports", 1100), "tab-back");
  assert.equal(slideMode(capture({ kind: "tab", mobile: false }), "/hub/my-reports", 1100), "fade");
});

test("tabPosition: urutan bottom nav; halaman lain berada di tombol Menu (paling kanan)", () => {
  assert.equal(tabPosition("/hub", TABS), 0);
  assert.equal(tabPosition("/hub/", TABS), 0);
  assert.equal(tabPosition("/hub/my-reports", TABS), 2);
  assert.equal(tabPosition("/hub/my-attendance?absen=1", TABS), 1);
  assert.equal(tabPosition("/hub/notifications", TABS), 4);
});

test("tabDirection: tab tujuan di kanan = masuk dari kanan, di kiri = masuk dari kiri", () => {
  assert.equal(tabDirection("/hub/my-reports", "/hub/my-attendance", TABS), "back");
  assert.equal(tabDirection("/hub/my-attendance", "/hub/my-billing", TABS), "forward");
  assert.equal(tabDirection("/hub/my-billing", "/hub", TABS), "back");
  assert.equal(tabDirection("/hub/my-reports", "/hub/announcements", TABS), "forward", "halaman dari laci Menu = paling kanan");
  assert.equal(tabDirection("/hub/announcements", "/hub/my-billing", TABS), "back");
  assert.equal(tabDirection("/hub/announcements", "/hub/leave", TABS), "forward", "sesama halaman Menu: masuk dari kanan");
});

test("traverseKind: tombol kembali/maju membalik jenis langkah yang dilalui", () => {
  const steps = rememberStep(rememberStep({}, "/hub", "/hub/my-attendance", "push"), "/hub/my-attendance", "/hub/my-reports", "tab");
  assert.equal(traverseKind(steps, "/hub/my-reports", "/hub/my-attendance", TABS), "tab");
  assert.equal(traverseKind(steps, "/hub/my-attendance", "/hub/my-reports", TABS), "tab", "maju lagi");
  assert.equal(traverseKind(steps, "/hub/my-attendance", "/hub", TABS), "push", "masuk lewat ubin beranda = kembali ala iOS");
  // Langkah tak dikenal (mis. setelah muat ulang): antarhalaman bottom nav = tab, selain itu push.
  assert.equal(traverseKind({}, "/hub/my-billing", "/hub", TABS), "tab");
  assert.equal(traverseKind({}, "/hub/notifications", "/hub/my-reports", TABS), "push");
});

test("rememberStep: langkah terakhir antara dua halaman yang berlaku; aslinya tidak berubah", () => {
  const before = rememberStep({}, "/hub", "/hub/my-attendance", "push");
  const after = rememberStep(before, "/hub/my-attendance", "/hub", "tab");
  assert.equal(traverseKind(before, "/hub/my-attendance", "/hub", TABS), "push", "tidak memutasi aslinya");
  assert.equal(traverseKind(after, "/hub/my-attendance", "/hub", TABS), "tab");
});

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
