/**
 * Aturan murni tema sekolah yang TERSIMPAN (kolom `School.theme*`, tanpa Prisma): kunci preset,
 * resolusi kolom -> tema efektif, dan pembanding no-op untuk PUT/DELETE /school/theme.
 * Warna & preset sendiri didefinisikan di theme-rules.ts (dipakai juga oleh web).
 */
import { DEFAULT_THEME, THEME_KEYS, normalizeHex, type SchoolThemeColors, type ThemeKey } from "./theme-rules";

/** Kunci THEME_PRESETS sebagai tuple literal (untuk z.enum); urutan sama, dijaga unit test. */
export const THEME_PRESET_KEYS = ["nusantara", "madani", "merah-putih", "cendekia", "mentari", "samudra", "pertiwi", "grafit"] as const;
export type ThemePresetKey = (typeof THEME_PRESET_KEYS)[number];

/** Preset untuk tema bawaan (kolom kosong). */
export const DEFAULT_THEME_PRESET: ThemePresetKey = "nusantara";

const PRESET_KEY_SET: ReadonlySet<string> = new Set(THEME_PRESET_KEYS);

export function isThemePresetKey(value: unknown): value is ThemePresetKey {
  return typeof value === "string" && PRESET_KEY_SET.has(value);
}

/** Isi kolom tema apa adanya: `null` = kosong (tema bawaan). */
export interface StoredTheme {
  readonly preset: string | null;
  readonly colors: Partial<Record<ThemeKey, string | null>>;
}

export interface ResolvedStoredTheme {
  /** Preset asal palet; `null` = palet kustom / preset tak dikenal. */
  readonly preset: ThemePresetKey | null;
  readonly colors: SchoolThemeColors;
  /** false = kolom kosong -> tema bawaan aplikasi. */
  readonly isCustom: boolean;
}

/** Kelima warna bila SEMUANYA valid; selain itu null (palet sebagian tidak pernah dipakai). */
function completePalette(colors: StoredTheme["colors"]): SchoolThemeColors | null {
  const entries = THEME_KEYS.map((key) => [key, normalizeHex(colors[key])] as const);
  if (entries.some(([, value]) => value === null)) return null;
  return Object.fromEntries(entries) as SchoolThemeColors;
}

/**
 * Tema efektif dari kolom tersimpan: palet lengkap & valid -> kustom (preset tak dikenal -> null);
 * selain itu seluruhnya tema bawaan dengan preset `nusantara`.
 */
export function resolveStoredTheme(stored: StoredTheme): ResolvedStoredTheme {
  const palette = completePalette(stored.colors);
  if (!palette) return { preset: DEFAULT_THEME_PRESET, colors: DEFAULT_THEME, isCustom: false };
  return { preset: isThemePresetKey(stored.preset) ? stored.preset : null, colors: palette, isCustom: true };
}

/** Sama persis sebagai isi kolom (preset + kelima warna; null = null). Dipakai untuk no-op tanpa audit. */
export function sameStoredTheme(a: StoredTheme, b: StoredTheme): boolean {
  if ((a.preset ?? null) !== (b.preset ?? null)) return false;
  return THEME_KEYS.every((key) => normalizeHex(a.colors[key]) === normalizeHex(b.colors[key]));
}
