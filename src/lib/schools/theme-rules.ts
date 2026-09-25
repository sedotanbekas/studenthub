/**
 * Aturan murni tema warna sekolah (tanpa Prisma / DOM): format warna, rasio kontras WCAG, dan turunan
 * token CSS. Dipakai server (validasi & DTO) dan web (menerapkan tema ke `:root`). Admin bebas memilih
 * warna; turunan di sini menjamin teks di atas warna tema tetap terbaca (kontras minimal 4.5:1).
 */
export const THEME_KEYS = ["primaryColor", "secondaryColor", "bannerColor", "animationColor", "logoColor"] as const;
export type ThemeKey = (typeof THEME_KEYS)[number];
export type SchoolThemeColors = { readonly [K in ThemeKey]: string };

/** Warna yang disimpan: selalu `#rrggbb` huruf kecil. */
export const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/;

export const DEFAULT_THEME: SchoolThemeColors = {
  primaryColor: "#1d4ed8",
  secondaryColor: "#0f766e",
  bannerColor: "#1e3a8a",
  animationColor: "#38bdf8",
  logoColor: "#1d4ed8",
};

export interface ThemePreset {
  readonly key: string;
  readonly label: string;
  readonly colors: SchoolThemeColors;
}

const preset = (key: string, label: string, primaryColor: string, secondaryColor: string, bannerColor: string, animationColor: string, logoColor: string): ThemePreset =>
  ({ key, label, colors: { primaryColor, secondaryColor, bannerColor, animationColor, logoColor } });

/** Titik awal cepat di halaman tema; preset pertama = tema bawaan. */
export const THEME_PRESETS: readonly ThemePreset[] = [
  preset("nusantara", "Biru Nusantara", DEFAULT_THEME.primaryColor, DEFAULT_THEME.secondaryColor, DEFAULT_THEME.bannerColor, DEFAULT_THEME.animationColor, DEFAULT_THEME.logoColor),
  preset("madani", "Hijau Madani", "#15803d", "#a16207", "#14532d", "#4ade80", "#15803d"),
  preset("merah-putih", "Merah Putih", "#b91c1c", "#1f2937", "#7f1d1d", "#f87171", "#b91c1c"),
  preset("cendekia", "Ungu Cendekia", "#6d28d9", "#be185d", "#4c1d95", "#a78bfa", "#6d28d9"),
  preset("mentari", "Oranye Mentari", "#c2410c", "#0369a1", "#7c2d12", "#fb923c", "#ea580c"),
  preset("samudra", "Teal Samudra", "#0f766e", "#1d4ed8", "#134e4a", "#2dd4bf", "#0f766e"),
  preset("pertiwi", "Emas Pertiwi", "#a16207", "#7c2d12", "#422006", "#facc15", "#ca8a04"),
  preset("grafit", "Grafit Minimalis", "#111827", "#4b5563", "#1f2937", "#94a3b8", "#111827"),
];

const WHITE = "#ffffff";
const BLACK = "#000000";
/** Warna teks gelap aplikasi (--ink). */
const INK = "#0b1220";
/** Kontras minimal teks isi (WCAG AA). */
const TEXT_CONTRAST = 4.5;
/** Kontras komponen non-teks (garis fokus, indikator aktif) — WCAG 1.4.11. */
const LINE_CONTRAST = 3;
/** Kontras teks aksen di atas latar putih/lembut (setara AAA, sesuai sistem kontras tinggi). */
const INK_CONTRAST = 7;
const MIX_STEP = 0.05;

export function normalizeHex(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim().toLowerCase();
  if (HEX_COLOR_PATTERN.test(value)) return value;
  if (/^#[0-9a-f]{3}$/.test(value)) return `#${[...value.slice(1)].map(c => c + c).join("")}`;
  return null;
}

type Rgb = readonly [number, number, number];

function rgb(hex: string): Rgb {
  const value = normalizeHex(hex) ?? BLACK;
  return [parseInt(value.slice(1, 3), 16), parseInt(value.slice(3, 5), 16), parseInt(value.slice(5, 7), 16)];
}

function hex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map(c => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`;
}

/** Campuran linear per kanal sRGB: `weight` 0 = `from`, 1 = `to`. */
export function mixHex(from: string, to: string, weight: number): string {
  const w = Math.min(1, Math.max(0, weight));
  const a = rgb(from); const b = rgb(to);
  return hex([a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w]);
}

function linear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(color: string): number {
  const [r, g, b] = rgb(color);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** Rasio kontras WCAG 2.x (1..21). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a); const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Warna teks untuk latar `background`: putih bila cukup kontras, selain itu yang paling kontras. */
export function readableText(background: string): string {
  const onWhite = contrastRatio(background, WHITE);
  return onWhite >= TEXT_CONTRAST || onWhite >= contrastRatio(background, INK) ? WHITE : INK;
}

/** Geser `color` ke hitam (latar terang) / putih (latar gelap) sampai kontras terhadap `against` >= `min`. */
export function inkFor(color: string, against: string, min: number): string {
  const base = normalizeHex(color) ?? INK;
  if (contrastRatio(base, against) >= min) return base;
  const target = luminance(against) > 0.18 ? BLACK : WHITE;
  for (let weight = MIX_STEP; weight < 1; weight += MIX_STEP) {
    const candidate = mixHex(base, target, weight);
    if (contrastRatio(candidate, against) >= min) return candidate;
  }
  return target;
}

/** Latar berisi teks: bila tak ada warna teks yang mencapai 4.5:1, gelapkan latarnya sedikit. */
function surfaceColor(color: string): string {
  const best = Math.max(contrastRatio(color, WHITE), contrastRatio(color, INK));
  return best >= TEXT_CONTRAST ? color : inkFor(color, WHITE, TEXT_CONTRAST);
}

/** Tema dari data tersimpan (boleh sebagian / tidak valid): tiap kunci jatuh ke warna bawaan. */
export function resolveTheme(input: Partial<Record<ThemeKey, unknown>> | null | undefined): SchoolThemeColors {
  const source = input ?? {};
  return Object.fromEntries(THEME_KEYS.map(key => [key, normalizeHex(source[key]) ?? DEFAULT_THEME[key]])) as SchoolThemeColors;
}

export function sameTheme(a: SchoolThemeColors, b: SchoolThemeColors): boolean {
  return THEME_KEYS.every(key => normalizeHex(a[key]) === normalizeHex(b[key]));
}

function hoverOf(surface: string, onSurface: string): string {
  return onSurface === WHITE ? mixHex(surface, BLACK, 0.14) : mixHex(surface, WHITE, 0.2);
}

function bannerPartner(banner: string, onBanner: string, primary: string): string {
  const blend = mixHex(banner, primary, 0.45);
  if (contrastRatio(onBanner, blend) >= TEXT_CONTRAST) return blend;
  return onBanner === WHITE ? mixHex(banner, BLACK, 0.2) : mixHex(banner, WHITE, 0.35);
}

/** Teks sekunder di atas banner: sedikit menyatu dengan banner, tetapi tetap >= 4.5:1 di kedua ujung gradien. */
function mutedOn(onBanner: string, banner: string, partner: string): string {
  const candidate = mixHex(onBanner, banner, 0.22);
  return contrastRatio(candidate, banner) >= TEXT_CONTRAST && contrastRatio(candidate, partner) >= TEXT_CONTRAST ? candidate : onBanner;
}

/** Token CSS turunan tema (nama variabel -> `#rrggbb`), siap dipasang di `:root`. */
export function themeVariables(theme: SchoolThemeColors): Record<string, string> {
  const t = resolveTheme(theme);
  const primary = surfaceColor(t.primaryColor);
  const onPrimary = readableText(primary);
  const secondary = surfaceColor(t.secondaryColor);
  const banner = surfaceColor(t.bannerColor);
  const onBanner = readableText(banner);
  const logo = surfaceColor(t.logoColor);
  const bannerEnd = bannerPartner(banner, onBanner, primary);
  return {
    "--primary": primary,
    "--primary-hover": hoverOf(primary, onPrimary),
    "--primary-ink": inkFor(t.primaryColor, WHITE, INK_CONTRAST),
    "--primary-line": inkFor(t.primaryColor, WHITE, LINE_CONTRAST),
    "--primary-soft": mixHex(t.primaryColor, WHITE, 0.88),
    "--on-primary": onPrimary,
    "--secondary": secondary,
    "--secondary-soft": mixHex(t.secondaryColor, WHITE, 0.88),
    "--secondary-ink": inkFor(t.secondaryColor, WHITE, INK_CONTRAST),
    "--on-secondary": readableText(secondary),
    "--banner": banner,
    "--banner-2": bannerEnd,
    "--on-banner": onBanner,
    "--on-banner-muted": mutedOn(onBanner, banner, bannerEnd),
    "--animation": t.animationColor,
    "--animation-soft": mixHex(t.animationColor, WHITE, 0.6),
    "--logo": logo,
    "--on-logo": readableText(logo),
  };
}
