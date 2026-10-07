#!/usr/bin/env node
/**
 * Membuat aset logo StudentHub dari gambar sumber (docs/brand/studenthub-logo.jpg, latar putih):
 * - public/brand/mark.webp            tanda "S + toga" transparan (UI: sidebar, topbar, login).
 * - public/brand/splash-body.webp     tanda bergaya stiker (bingkai & celah putih) tanpa rumbai — splash.
 * - public/brand/splash-tassel.webp   rumbai toga bergaya stiker (berayun di splash), kanvas sama.
 * - public/brand/splash-shape.webp    siluet gabungan (alfa) = bentuk lubang masker saat halaman disingkap.
 * - public/brand/icon-96.png (96 px), apple-icon-180.png (180 px, latar putih)  favicon & ikon layar utama iOS
 *   (dipasang lewat metadata app/layout.tsx; logo unggahan Pengaturan aplikasi menggantikannya di /hub).
 * - public/brand/app-192.png, app-512.png (latar putih), app-maskable-512.png (tanda 70% — zona aman maskable),
 *   badge-96.png (siluet putih beralfa; Android hanya memakai alfanya)  ikon PWA & notifikasi (N3).
 *   Bila logo berganti, GANTI NAMA berkas ikon PWA (Chrome hanya memperbarui ikon terpasang bila URL-nya berubah).
 * Mencetak geometri splash (titik pusat zoom, jari-jari lingkaran dalam, poros rumbai) untuk
 * src/lib/frontend/splash-rules.ts. Jalankan: node scripts/brand-assets.mjs [sumber.jpg]
 */
import sharp from "sharp";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE = resolve(process.argv[2] ?? "docs/brand/studenthub-logo.jpg");
const OUT = resolve("public/brand");
/** Baris terakhir tanda (di bawahnya tulisan "StudentHub" — tulisan dirender sebagai teks, bukan gambar). */
const MARK_BOTTOM = 940;
/** Rumbai yang menggantung di bawah papan toga (di atas latar putih) + porosnya (koordinat sumber). */
const PENDANT = { x0: 880, x1: 1010, y0: 352, y1: MARK_BOTTOM };
const PIVOT = { x: 933, y: 352 };
/** Penutupan morfologi (isi celah putih di dalam huruf S) dan tebal bingkai stiker, piksel sumber. */
const CLOSE_RADIUS = 44;
const PENDANT_CLOSE_RADIUS = 8;
const RIM = 16;
const SPLASH_SIZE = 512;
/** Logo UI tampil paling besar 42 px (login/sidebar): 128 px = tajam di layar 3x, file kecil untuk PageSpeed. */
const MARK_SIZE = 128;

/** Transformasi jarak Euclid kuadrat 1D (Felzenszwalb & Huttenlocher). */
function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
}

/** Jarak (piksel) setiap titik ke piksel `mask` terdekat (0 di dalam mask). */
function distanceTo(mask, W, H) {
  const INF = 1e12, n = Math.max(W, H);
  const grid = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) grid[i] = mask[i] ? 0 : INF;
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = grid[y * W + x];
    edt1d(f, H, d, v, z);
    for (let y = 0; y < H; y++) grid[y * W + x] = d[y];
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) f[x] = grid[y * W + x];
    edt1d(f, W, d, v, z);
    for (let x = 0; x < W; x++) grid[y * W + x] = Math.sqrt(d[x]);
  }
  return grid;
}

const dilate = (mask, r, W, H) => distanceTo(mask, W, H).map(dist => (dist <= r ? 1 : 0));
const invert = mask => mask.map(m => (m ? 0 : 1));
/** Penutupan: celah & lekuk yang lebih sempit dari 2r terisi (bentuk stiker yang membulat). */
const close = (mask, r, W, H) => invert(dilate(invert(dilate(mask, r, W, H)), r, W, H));
/** Bingkai stiker lembut (antialias 1 px) selebar `rim` di sekeliling mask. */
function sticker(mask, rim, W, H) {
  const dist = distanceTo(mask, W, H);
  return dist.map(dd => Math.min(1, Math.max(0, rim + 0.5 - dd)));
}

/** Alfa dari latar putih + warna asli (un-premultiply) per piksel. */
function separate(data, W, H) {
  const alpha = new Float64Array(W * H), rgb = new Uint8ClampedArray(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    const [r, g, b] = [data[i * 3], data[i * 3 + 1], data[i * 3 + 2]];
    const a = Math.min(1, Math.max(0, (Math.max(255 - r, 255 - g, 255 - b) - 6) / 90));
    alpha[i] = Math.floor(i / W) < MARK_BOTTOM ? a : 0;
    for (const [k, c] of [r, g, b].entries()) rgb[i * 3 + k] = a > 0 ? (c - 255 * (1 - a)) / a : 255;
  }
  return { alpha, rgb };
}

function isPendant(i, W, data, alpha) {
  const x = i % W, y = Math.floor(i / W);
  if (alpha[i] <= 0 || x < PENDANT.x0 || x > PENDANT.x1 || y < PENDANT.y0 || y > PENDANT.y1) return false;
  return data[i * 3] - data[i * 3 + 2] > 8; // kuning/oranye; campuran biru/ungu + putih selalu biru >= merah
}

/** Lapisan RGBA: warna tanda di atas stiker putih. */
function layer(rgb, colorAlpha, stickerAlpha, W, H) {
  const out = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const a = colorAlpha[i];
    for (let k = 0; k < 3; k++) out[i * 4 + k] = Math.round(rgb[i * 3 + k] * a + 255 * (1 - a));
    out[i * 4 + 3] = Math.round(255 * Math.max(a, stickerAlpha[i]));
  }
  return out;
}

function bbox(alpha, W, H, threshold) {
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let i = 0; i < W * H; i++) if (alpha[i] > threshold) { const x = i % W, y = Math.floor(i / W); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1 };
}

/** Kotak persegi berpusat pada bbox dengan margin, tetap di dalam gambar (latar di luar = transparan). */
function squareAround(b, margin) {
  const side = Math.ceil(Math.max(b.x1 - b.x0, b.y1 - b.y0) * (1 + 2 * margin));
  return { left: Math.round((b.x0 + b.x1 - side) / 2), top: Math.round((b.y0 + b.y1 - side) / 2), side };
}

async function save(buffer, W, H, crop, size, file, format = "webp") {
  // extend dulu agar potongan boleh keluar batas gambar sumber tanpa galat.
  const pad = crop.side;
  let img = sharp(buffer, { raw: { width: W, height: H, channels: 4 } })
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 255, g: 255, b: 255, alpha: 0 } });
  img = sharp(await img.raw().toBuffer(), { raw: { width: W + 2 * pad, height: H + 2 * pad, channels: 4 } })
    .extract({ left: crop.left + pad, top: crop.top + pad, width: crop.side, height: crop.side })
    .resize(size, size, { kernel: "lanczos3" });
  if (format === "webp") await img.webp({ quality: 90, alphaQuality: 100, effort: 6 }).toFile(file);
  else await img.png({ compressionLevel: 9, palette: true, quality: 95 }).toFile(file);
  console.log(`Aset: ${file}`);
}

async function main() {
  const { data, info } = await sharp(SOURCE).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const { alpha, rgb } = separate(data, W, H);
  const pendant = alpha.map((_, i) => (isPendant(i, W, data, alpha) ? 1 : 0));
  const bodyAlpha = alpha.map((a, i) => (pendant[i] ? 0 : a));
  const pendantAlpha = alpha.map((a, i) => (pendant[i] ? a : 0));
  const bodySticker = sticker(close(bodyAlpha.map(a => (a > 0.5 ? 1 : 0)), CLOSE_RADIUS, W, H), RIM, W, H);
  const pendantSticker = sticker(close(pendantAlpha.map(a => (a > 0.5 ? 1 : 0)), PENDANT_CLOSE_RADIUS, W, H), RIM, W, H);
  const shape = bodySticker.map((a, i) => Math.max(a, pendantSticker[i]));

  mkdirSync(OUT, { recursive: true });
  const splashCrop = squareAround(bbox(shape, W, H, 0.01), 0.03);
  const white = new Float64Array(W * H);
  const shapeRgba = layer(new Uint8ClampedArray(W * H * 3).fill(255), white, shape, W, H);
  await save(layer(rgb, bodyAlpha, bodySticker, W, H), W, H, splashCrop, SPLASH_SIZE, `${OUT}/splash-body.webp`);
  await save(layer(rgb, pendantAlpha, pendantSticker, W, H), W, H, splashCrop, SPLASH_SIZE, `${OUT}/splash-tassel.webp`);
  await save(shapeRgba, W, H, splashCrop, SPLASH_SIZE, `${OUT}/splash-shape.webp`);

  const markCrop = squareAround(bbox(alpha, W, H, 0.05), 0.04);
  const markRgba = layer(rgb, alpha, white, W, H);
  await save(markRgba, W, H, markCrop, MARK_SIZE, `${OUT}/mark.webp`);
  await save(markRgba, W, H, markCrop, 96, `${OUT}/icon-96.png`, "png");
  await appleIcon(markRgba, W, H, markCrop);
  await pwaIcons(markRgba, alpha, W, H, markCrop);
  printGeometry(shape, W, H, splashCrop);
}

/** Tanda di tengah kanvas persegi berlatar putih pekat (ukuran `size`, tanda `ratio` dari sisi). */
async function paddedIcon(markRgba, W, H, markCrop, size, ratio, file) {
  const inner = Math.round(size * ratio);
  const tmp = resolve(OUT, ".padded-mark.png");
  await save(markRgba, W, H, markCrop, inner, tmp, "png");
  const offset = Math.round((size - inner) / 2);
  await sharp({ create: { width: size, height: size, channels: 4, background: "#ffffff" } })
    .composite([{ input: tmp, left: offset, top: offset }]).flatten({ background: "#ffffff" }).png({ compressionLevel: 9, palette: true, quality: 95 }).toFile(file);
  rmSync(tmp);
  console.log(`Aset: ${file}`);
}

/** Ikon layar utama iOS: latar putih pekat (iOS membulatkan sudutnya sendiri), tanda 76%. */
async function appleIcon(markRgba, W, H, markCrop) {
  await paddedIcon(markRgba, W, H, markCrop, 180, 0.76, `${OUT}/apple-icon-180.png`);
}

/** Ikon PWA (manifest) & ikon badge notifikasi (N3). */
async function pwaIcons(markRgba, alpha, W, H, markCrop) {
  await paddedIcon(markRgba, W, H, markCrop, 192, 0.76, `${OUT}/app-192.png`);
  await paddedIcon(markRgba, W, H, markCrop, 512, 0.76, `${OUT}/app-512.png`);
  await paddedIcon(markRgba, W, H, markCrop, 512, 0.7, `${OUT}/app-maskable-512.png`);
  const silhouette = layer(new Uint8ClampedArray(W * H * 3).fill(255), alpha.map(a => (a > 0.35 ? 1 : 0)), new Float64Array(W * H), W, H);
  await save(silhouette, W, H, squareAround(bbox(alpha, W, H, 0.05), 0.12), 96, `${OUT}/badge-96.png`, "png");
}

/** Titik terdalam siluet (pusat zoom masker) & jari-jari lingkaran dalamnya, relatif sisi kanvas splash. */
function printGeometry(shape, W, H, crop) {
  const inside = distanceTo(invert(shape.map(a => (a > 0.5 ? 1 : 0))), W, H);
  let best = 0, bx = 0, by = 0;
  for (let i = 0; i < W * H; i++) if (inside[i] > best) { best = inside[i]; bx = i % W; by = Math.floor(i / W); }
  const rel = (value, origin) => Number(((value - origin) / crop.side).toFixed(4));
  console.log(JSON.stringify({ origin: { x: rel(bx, crop.left), y: rel(by, crop.top) }, inscribed: Number((best / crop.side).toFixed(4)), pivot: { x: rel(PIVOT.x, crop.left), y: rel(PIVOT.y, crop.top) } }));
}

await main();
