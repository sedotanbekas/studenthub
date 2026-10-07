import { test } from "node:test";
import assert from "node:assert/strict";
import { appTitle, checkLogoMeta, DEFAULT_APP_NAME, logoUrlFor, LOGO_MAX_SIDE, normalizeAppName, splitBrandName } from "./rules";

test("normalizeAppName: spasi dirapikan; terlalu pendek/panjang atau karakter kendali -> null", () => {
  assert.equal(normalizeAppName("  Student   Hub "), "Student Hub");
  assert.equal(normalizeAppName("SekolahKu"), "SekolahKu");
  assert.equal(normalizeAppName("A"), null);
  assert.equal(normalizeAppName("   "), null);
  assert.equal(normalizeAppName("x".repeat(41)), null);
  assert.equal(normalizeAppName("x".repeat(40)), "x".repeat(40));
  assert.equal(normalizeAppName("Nama\u0000Jahat"), null);
  assert.equal(normalizeAppName("Baris\nBaru"), "Baris Baru");
  assert.equal(normalizeAppName("<b>Hub</b>"), null, "tanda kurung sudut ditolak (nama tampil di judul & manifest)");
});

test("checkLogoMeta: hanya JPEG/PNG/WebP statis, sisi terpendek >= 64 px, <= 25 MP", () => {
  const ok = { format: "png", width: 512, height: 512 };
  assert.equal(checkLogoMeta(ok), null);
  assert.equal(checkLogoMeta({ ...ok, format: "gif" }), "FORMAT");
  assert.equal(checkLogoMeta({ ...ok, format: "svg" }), "FORMAT");
  assert.equal(checkLogoMeta({ ...ok, pages: 3 }), "ANIMATED");
  assert.equal(checkLogoMeta({ ...ok, width: 63 }), "TOO_SMALL");
  assert.equal(checkLogoMeta({ ...ok, width: 64, height: 64 }), null);
  assert.equal(checkLogoMeta({ ...ok, width: 6000, height: 5000 }), "PIXELS");
  assert.equal(checkLogoMeta({ format: "webp", width: 1200, height: 300 }), null, "logo melebar tetap boleh");
  assert.equal(LOGO_MAX_SIDE, 512);
});

test("logoUrlFor: URL publik berversi waktu ubah; tanpa logo -> null", () => {
  assert.equal(logoUrlFor(null), null);
  assert.equal(logoUrlFor(new Date("2026-10-07T01:02:03.004Z")), `/api/v1/app/logo?v=${Date.parse("2026-10-07T01:02:03.004Z")}`);
});

test("appTitle: nama aplikasi + isi aplikasi (judul tab & manifest)", () => {
  assert.equal(appTitle(DEFAULT_APP_NAME), "Student Hub - Absensi, Rapor & Tagihan Sekolah");
  assert.equal(appTitle("SekolahKu"), "SekolahKu - Absensi, Rapor & Tagihan Sekolah");
});

test("splitBrandName: kata terakhir diberi warna aksen; nama bawaan tetap 'Student' + 'Hub'", () => {
  assert.deepEqual(splitBrandName(DEFAULT_APP_NAME), { head: "Student", tail: "Hub" }, "logo kata 'StudentHub' tanpa spasi");
  assert.deepEqual(splitBrandName("Sekolah Pintar Nusantara"), { head: "Sekolah Pintar ", tail: "Nusantara" });
  assert.deepEqual(splitBrandName("SekolahKu"), { head: "SekolahKu", tail: "" });
});
