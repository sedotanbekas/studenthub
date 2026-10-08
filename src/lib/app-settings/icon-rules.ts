import type { Metadata } from "next";
import { MARK_INSCRIBED, MARK_ORIGIN } from "@/lib/frontend/splash-rules";

/**
 * Aturan murni ikon aplikasi dari logo unggahan (Pengaturan aplikasi, pemilik 2026-10-07): SEMUA logo ikut berganti
 * -- favicon, ikon layar utama iOS, ikon PWA (biasa & maskable), badge notifikasi, dan splash (termasuk bentuk
 * masker animasinya). Tanpa logo unggahan = aset bawaan di public/brand (scripts/brand-assets.mjs).
 */
export interface IconVariant {
  /** Sisi kanvas persegi (px). */
  readonly size: number;
  /** Sisi terpanjang logo terhadap sisi kanvas. */
  readonly ratio: number;
  /** Latar pekat; null = transparan. */
  readonly background: string | null;
  /** Siluet putih dari alfa logo (badge notifikasi Android). */
  readonly silhouette: boolean;
  readonly format: "png" | "webp";
}

const variant = (size: number, ratio: number, background: string | null, format: "png" | "webp" = "png", silhouette = false): IconVariant =>
  Object.freeze({ size, ratio, background, silhouette, format });

/** Proporsi sama dengan aset bawaan (brand-assets.mjs): ikon berlatar putih 76%, maskable 70% (zona aman). */
export const ICON_VARIANTS = Object.freeze({
  favicon: variant(96, 0.92, null),
  apple: variant(180, 0.76, "#ffffff"),
  "app-192": variant(192, 0.76, "#ffffff"),
  "app-512": variant(512, 0.76, "#ffffff"),
  "maskable-512": variant(512, 0.7, "#ffffff"),
  badge: variant(96, 0.84, null, "png", true),
  /** Kanvas splash: logo + bentuk lubang masker (alfa) saat halaman disingkap. */
  splash: variant(512, 0.94, null, "webp"),
});
export type IconVariantName = keyof typeof ICON_VARIANTS;
export const ICON_VARIANT_NAMES = Object.keys(ICON_VARIANTS) as IconVariantName[];

export const isIconVariant = (value: string): value is IconVariantName => Object.hasOwn(ICON_VARIANTS, value);

const DEFAULT_FILES: Readonly<Record<IconVariantName, string>> = Object.freeze({
  favicon: "/brand/icon-96.png",
  apple: "/brand/apple-icon-180.png",
  "app-192": "/brand/app-192.png",
  "app-512": "/brand/app-512.png",
  "maskable-512": "/brand/app-maskable-512.png",
  badge: "/brand/badge-96.png",
  splash: "/brand/splash-shape.webp",
});

/** URL ikon: logo unggahan -> route berversi (berganti saat logo diganti); tanpa logo -> aset bawaan. */
export function iconUrlFor(name: IconVariantName, logoUpdatedAt: Date | null): string {
  return logoUpdatedAt ? `/api/v1/app/icon/${name}?v=${logoUpdatedAt.getTime()}` : DEFAULT_FILES[name];
}

export interface AppIcons {
  readonly favicon: string;
  readonly apple: string;
  readonly app192: string;
  readonly app512: string;
  readonly maskable512: string;
  readonly badge: string;
}

export function appIcons(logoUpdatedAt: Date | null): AppIcons {
  const url = (name: IconVariantName) => iconUrlFor(name, logoUpdatedAt);
  return { favicon: url("favicon"), apple: url("apple"), app192: url("app-192"), app512: url("app-512"), maskable512: url("maskable-512"), badge: url("badge") };
}

export const DEFAULT_ICONS: AppIcons = appIcons(null);

/**
 * Metadata identitas aplikasi untuk halaman yang bisa dipasang (/hub, /pasang): nama aplikasi terpasang & judul
 * layar utama iOS. Logo unggahan juga menjadi favicon & ikon layar utama iOS; tanpa logo = ikon bawaan app/layout.tsx.
 */
export function appIdentityMetadata(appName: string, logoUpdatedAt: Date | null): Pick<Metadata, "applicationName" | "appleWebApp" | "icons"> {
  const base = { applicationName: appName, appleWebApp: { title: appName, capable: true, statusBarStyle: "default" as const } };
  if (!logoUpdatedAt) return base;
  const icons = appIcons(logoUpdatedAt);
  return { ...base, icons: { icon: [{ url: icons.favicon, type: "image/png", sizes: "96x96" }], apple: [{ url: icons.apple, sizes: "180x180" }] } };
}

/** Geometri masker splash relatif sisi kanvas: pusat zoom (titik terdalam siluet) & jari-jari lingkaran dalamnya. */
export interface MaskGeometry {
  readonly ox: number;
  readonly oy: number;
  readonly inscribed: number;
}

const round4 = (value: number) => Math.floor(value * 10_000) / 10_000;
const CHAMFER_AXIS = 3;
const CHAMFER_DIAG = 4;

/** Jarak chamfer 3-4 tiap piksel buram ke piksel transparan terdekat (luar kanvas = transparan). */
function distanceInside(inside: Uint8Array, n: number): Float64Array {
  const d = new Float64Array(n * n);
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= n || y >= n ? 0 : d[y * n + x]!);
  for (let i = 0; i < n * n; i++) d[i] = inside[i] ? Number.POSITIVE_INFINITY : 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x;
    if (d[i]) d[i] = Math.min(d[i]!, at(x - 1, y) + CHAMFER_AXIS, at(x, y - 1) + CHAMFER_AXIS, at(x - 1, y - 1) + CHAMFER_DIAG, at(x + 1, y - 1) + CHAMFER_DIAG);
  }
  for (let y = n - 1; y >= 0; y--) for (let x = n - 1; x >= 0; x--) {
    const i = y * n + x;
    if (d[i]) d[i] = Math.min(d[i]!, at(x + 1, y) + CHAMFER_AXIS, at(x, y + 1) + CHAMFER_AXIS, at(x + 1, y + 1) + CHAMFER_DIAG, at(x - 1, y + 1) + CHAMFER_DIAG);
  }
  return d;
}

/**
 * Titik terdalam siluet (alfa >= 128) pada kanvas persegi n×n beserta jari-jari lingkaran dalamnya; seri =
 * yang terdekat ke tengah kanvas. Kanvas kosong/ukuran salah -> null.
 */
export function maskGeometry(alpha: Uint8Array, n: number): MaskGeometry | null {
  if (n < 2 || alpha.length !== n * n) return null;
  const d = distanceInside(alpha.map(a => (a >= 128 ? 1 : 0)), n);
  let best = 0;
  let pick = -1;
  let pickGap = Number.POSITIVE_INFINITY;
  for (let i = 0; i < n * n; i++) {
    const gap = Math.hypot((i % n) + 0.5 - n / 2, Math.floor(i / n) + 0.5 - n / 2);
    if (d[i]! > best || (d[i]! === best && best > 0 && gap < pickGap)) { best = d[i]!; pick = i; pickGap = gap; }
  }
  if (pick < 0) return null;
  const radius = Math.max(0, best / CHAMFER_AXIS - 0.5);
  return { ox: round4(((pick % n) + 0.5) / n), oy: round4((Math.floor(pick / n) + 0.5) / n), inscribed: round4(radius / n) };
}

const fraction = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

/** JSON tersimpan -> geometri (nilai rusak diabaikan, bukan dipercaya). */
export function parseGeometry(value: unknown): MaskGeometry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { ox, oy, inscribed } = value as Record<string, unknown>;
  return fraction(ox) && fraction(oy) && fraction(inscribed) && inscribed > 0 ? { ox, oy, inscribed } : null;
}

/** Geometri yang dipakai splash: logo unggahan atau tanda "S + toga" bawaan. */
export function splashGeometry(geometry: MaskGeometry | null): MaskGeometry {
  return geometry ?? { ox: MARK_ORIGIN.x, oy: MARK_ORIGIN.y, inscribed: MARK_INSCRIBED };
}
