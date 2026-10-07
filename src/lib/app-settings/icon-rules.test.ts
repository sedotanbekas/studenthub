import { test } from "node:test";
import assert from "node:assert/strict";
import { appIcons, DEFAULT_ICONS, ICON_VARIANTS, iconUrlFor, isIconVariant, maskGeometry, parseGeometry, splashGeometry } from "./icon-rules";
import { MARK_INSCRIBED, MARK_ORIGIN } from "@/lib/frontend/splash-rules";

/** Kanvas alfa n×n dari predikat piksel (true = buram). */
function canvas(n: number, opaque: (x: number, y: number) => boolean): Uint8Array {
  const alpha = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) alpha[y * n + x] = opaque(x, y) ? 255 : 0;
  return alpha;
}

test("maskGeometry: lingkaran penuh di tengah -> pusat (0.5, 0.5), jari-jari dalam ~ jari-jari lingkaran", () => {
  const n = 64;
  const g = maskGeometry(canvas(n, (x, y) => Math.hypot(x + 0.5 - 32, y + 0.5 - 32) <= 24), n);
  assert.ok(g);
  assert.ok(Math.abs(g.ox - 0.5) <= 0.02 && Math.abs(g.oy - 0.5) <= 0.02, JSON.stringify(g));
  assert.ok(g.inscribed >= 0.33 && g.inscribed <= 0.38, JSON.stringify(g));
});

test("maskGeometry: titik terdalam = bagian paling tebal (balok kiri tebal, garis kanan tipis)", () => {
  const n = 64;
  const g = maskGeometry(canvas(n, (x, y) => (x >= 4 && x < 28 && y >= 8 && y < 56) || (x >= 40 && x < 44 && y >= 8 && y < 56)), n);
  assert.ok(g);
  assert.ok(g.ox > 0.2 && g.ox < 0.27, `pusat di balok kiri: ${g.ox}`);
  assert.ok(Math.abs(g.oy - 0.5) <= 0.05);
});

test("maskGeometry: kanvas kosong/rusak -> null (splash memakai geometri bawaan)", () => {
  assert.equal(maskGeometry(new Uint8Array(64 * 64), 64), null);
  assert.equal(maskGeometry(new Uint8Array(10), 64), null);
});

test("parseGeometry & splashGeometry: JSON tersimpan divalidasi; tanpa logo = geometri tanda S bawaan", () => {
  assert.deepEqual(parseGeometry({ ox: 0.5, oy: 0.4, inscribed: 0.3 }), { ox: 0.5, oy: 0.4, inscribed: 0.3 });
  assert.equal(parseGeometry({ ox: 2, oy: 0.4, inscribed: 0.3 }), null);
  assert.equal(parseGeometry("x"), null);
  assert.equal(parseGeometry(null), null);
  assert.deepEqual(splashGeometry(null), { ox: MARK_ORIGIN.x, oy: MARK_ORIGIN.y, inscribed: MARK_INSCRIBED });
  assert.deepEqual(splashGeometry({ ox: 0.5, oy: 0.5, inscribed: 0.4 }), { ox: 0.5, oy: 0.5, inscribed: 0.4 });
});

test("varian ikon: ukuran & latar sesuai tujuan (favicon transparan, iOS/PWA berlatar putih, badge siluet)", () => {
  assert.equal(isIconVariant("app-192"), true);
  assert.equal(isIconVariant("../x"), false);
  assert.deepEqual([ICON_VARIANTS.favicon.size, ICON_VARIANTS.favicon.background], [96, null]);
  assert.deepEqual([ICON_VARIANTS.apple.size, ICON_VARIANTS.apple.background], [180, "#ffffff"]);
  assert.equal(ICON_VARIANTS["maskable-512"].ratio, 0.7);
  assert.equal(ICON_VARIANTS.badge.silhouette, true);
  assert.equal(ICON_VARIANTS.splash.format, "webp");
});

test("iconUrlFor & appIcons: URL berversi untuk logo unggahan; tanpa logo = aset bawaan /brand", () => {
  const at = new Date("2026-10-07T01:00:00.000Z");
  assert.equal(iconUrlFor("app-192", at), `/api/v1/app/icon/app-192?v=${at.getTime()}`);
  assert.equal(iconUrlFor("app-192", null), "/brand/app-192.png");
  assert.equal(iconUrlFor("badge", null), "/brand/badge-96.png");
  assert.deepEqual(appIcons(null), DEFAULT_ICONS);
  assert.equal(appIcons(at).maskable512, `/api/v1/app/icon/maskable-512?v=${at.getTime()}`);
});
