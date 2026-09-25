import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_THEME, THEME_KEYS, THEME_PRESETS } from "./theme-rules";
import {
  DEFAULT_THEME_PRESET,
  THEME_PRESET_KEYS,
  isThemePresetKey,
  resolveStoredTheme,
  sameStoredTheme,
  type StoredTheme,
} from "./theme-store-rules";

const EMPTY_STORED: StoredTheme = { preset: null, colors: {} };
const MADANI = THEME_PRESETS.find((p) => p.key === "madani")!;
const upperOf = (colors: Record<string, string>) => Object.fromEntries(THEME_KEYS.map((key) => [key, colors[key]!.toUpperCase()]));

test("THEME_PRESET_KEYS = kunci THEME_PRESETS (urutan sama), preset bawaan = preset pertama", () => {
  assert.deepEqual([...THEME_PRESET_KEYS], THEME_PRESETS.map((p) => p.key));
  assert.equal(DEFAULT_THEME_PRESET, THEME_PRESETS[0]!.key);
  assert.equal(DEFAULT_THEME_PRESET, "nusantara");
});

test("isThemePresetKey hanya menerima kunci preset yang dikenal", () => {
  assert.equal(isThemePresetKey("madani"), true);
  assert.equal(isThemePresetKey("merah-putih"), true);
  assert.equal(isThemePresetKey("MADANI"), false);
  assert.equal(isThemePresetKey("pelangi"), false);
  assert.equal(isThemePresetKey(null), false);
  assert.equal(isThemePresetKey(3), false);
});

test("resolveStoredTheme: kolom kosong -> tema bawaan, bukan kustom, preset nusantara", () => {
  assert.deepEqual(resolveStoredTheme(EMPTY_STORED), { preset: "nusantara", colors: DEFAULT_THEME, isCustom: false });
  const nulls = { primaryColor: null, secondaryColor: null, bannerColor: null, animationColor: null, logoColor: null };
  assert.deepEqual(resolveStoredTheme({ preset: null, colors: nulls }), { preset: "nusantara", colors: DEFAULT_THEME, isCustom: false });
});

test("resolveStoredTheme: palet lengkap -> kustom, warna huruf kecil, preset dikenal dipertahankan", () => {
  assert.deepEqual(resolveStoredTheme({ preset: "madani", colors: upperOf(MADANI.colors) }), { preset: "madani", colors: MADANI.colors, isCustom: true });
  assert.deepEqual(resolveStoredTheme({ preset: null, colors: MADANI.colors }), { preset: null, colors: MADANI.colors, isCustom: true });
});

test("resolveStoredTheme: preset tersimpan yang tak dikenal -> null (palet tetap kustom)", () => {
  const resolved = resolveStoredTheme({ preset: "preset-lama", colors: MADANI.colors });
  assert.equal(resolved.preset, null);
  assert.equal(resolved.isCustom, true);
  assert.deepEqual(resolved.colors, MADANI.colors);
});

test("resolveStoredTheme: palet sebagian / rusak -> seluruhnya tema bawaan (tidak pernah campuran)", () => {
  const partial = resolveStoredTheme({ preset: "madani", colors: { primaryColor: "#15803d" } });
  assert.deepEqual(partial, { preset: "nusantara", colors: DEFAULT_THEME, isCustom: false });
  const broken = resolveStoredTheme({ preset: null, colors: { ...MADANI.colors, logoColor: "hijau" } });
  assert.deepEqual(broken, { preset: "nusantara", colors: DEFAULT_THEME, isCustom: false });
});

test("sameStoredTheme membandingkan preset + kelima warna (null = null, huruf besar/kecil diabaikan)", () => {
  const stored: StoredTheme = { preset: "madani", colors: MADANI.colors };
  assert.equal(sameStoredTheme(stored, { preset: "madani", colors: upperOf(MADANI.colors) }), true);
  assert.equal(sameStoredTheme(EMPTY_STORED, { preset: null, colors: { primaryColor: null } }), true);
  assert.equal(sameStoredTheme(stored, { ...stored, preset: null }), false);
  assert.equal(sameStoredTheme(stored, { ...stored, colors: { ...MADANI.colors, bannerColor: "#000000" } }), false);
  assert.equal(sameStoredTheme(EMPTY_STORED, { preset: null, colors: DEFAULT_THEME }), false, "tema bawaan tersimpan eksplisit != kolom kosong");
});
