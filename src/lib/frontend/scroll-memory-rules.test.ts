import { test } from "node:test";
import assert from "node:assert/strict";
import { isSamePage, rememberPosition, savedPosition, scrollKey } from "./scroll-memory-rules";

test("scrollKey: satu halaman = satu kunci, tanpa query/hash/garis miring penutup", () => {
  assert.equal(scrollKey("/hub/my-reports"), "/hub/my-reports");
  assert.equal(scrollKey("/hub/my-attendance?absen=1"), "/hub/my-attendance", "?absen=1 bukan halaman lain");
  assert.equal(scrollKey("/hub#utama"), "/hub");
  assert.equal(scrollKey("/hub/"), "/hub");
  assert.equal(scrollKey("/"), "/");
});

test("rememberPosition: salinan baru per halaman, halaman lain & aslinya tidak berubah", () => {
  const before = { "/hub": 120 };
  const after = rememberPosition(before, "/hub/my-reports", 640);
  assert.deepEqual(after, { "/hub": 120, "/hub/my-reports": 640 });
  assert.deepEqual(before, { "/hub": 120 }, "tidak memutasi aslinya");
  assert.deepEqual(rememberPosition(after, "/hub", 0), { "/hub": 0, "/hub/my-reports": 640 });
});

test("rememberPosition: posisi subpiksel dibulatkan; pantulan gulir iOS (negatif) & NaN -> 0", () => {
  assert.equal(rememberPosition({}, "/hub", 412.6)["/hub"], 413);
  assert.equal(rememberPosition({}, "/hub", -38)["/hub"], 0);
  assert.equal(rememberPosition({}, "/hub", Number.NaN)["/hub"], 0);
});

test("savedPosition: posisi terakhir halaman; halaman yang belum pernah dibuka -> atas", () => {
  const positions = { "/hub/my-reports": 640 };
  assert.equal(savedPosition(positions, "/hub/my-reports"), 640);
  assert.equal(savedPosition(positions, "/hub/my-attendance"), 0);
});

test("isSamePage: tautan ke halaman yang sedang dibuka (mis. tab aktif ditekan lagi)", () => {
  assert.equal(isSamePage("/hub/my-reports", "/hub/my-reports"), true);
  assert.equal(isSamePage("/hub/", "/hub"), true);
  assert.equal(isSamePage("/hub/my-attendance?absen=1", "/hub/my-attendance"), true);
  assert.equal(isSamePage("/hub/my-attendance", "/hub/my-reports"), false);
  assert.equal(isSamePage("/hub", "/hub/my-reports"), false);
});
