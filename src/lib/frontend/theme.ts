import { DEFAULT_THEME, resolveTheme, themeVariables, type SchoolThemeColors } from "@/lib/schools/theme-rules";

/**
 * Menerapkan tema sekolah di browser: token CSS inline di <html> (turunan color-mix di :root ikut
 * berubah), warna bilah browser HP, tema contoh untuk mode demo, dan mode kaca (penuh/ringan/padat).
 * Warna selalu lewat resolveTheme (hex tervalidasi) sebelum setProperty — tidak pernah disisipkan ke
 * string <style>.
 */
const VARIABLE_NAMES = Object.keys(themeVariables(DEFAULT_THEME));
const DEMO_THEME_KEY = "studenthub_demo_theme";
const GLASS_KEY = "studenthub_glass";
/** navigator.deviceMemory (GB) di bawah/sama dengan ini -> kaca ringan (tanpa blur). */
const LOW_MEMORY_GB = 2;

interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Pasangan [token, nilai]; nilai null = hapus token (kembali ke bawaan CSS). */
export function themeStyleEntries(theme: SchoolThemeColors | null): [string, string | null][] {
  const vars = theme ? themeVariables(resolveTheme(theme)) : null;
  return VARIABLE_NAMES.map(name => [name, vars?.[name] ?? null]);
}

export function applyTheme(theme: SchoolThemeColors | null): void {
  const root = document.documentElement;
  for (const [name, value] of themeStyleEntries(theme)) {
    if (value) root.style.setProperty(name, value);
    else root.style.removeProperty(name);
  }
  const banner = themeVariables(theme ? resolveTheme(theme) : DEFAULT_THEME)["--banner"]!;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) { meta = document.createElement("meta"); meta.name = "theme-color"; document.head.append(meta); }
  meta.content = banner;
}

export function readDemoTheme(storage: KeyValueStorage): SchoolThemeColors | null {
  try {
    const raw = storage.getItem(DEMO_THEME_KEY);
    return raw ? resolveTheme(JSON.parse(raw) as Record<string, unknown>) : null;
  } catch { return null; } // data sesi rusak: pakai tema bawaan
}

export function writeDemoTheme(storage: KeyValueStorage, theme: SchoolThemeColors | null): void {
  if (theme) storage.setItem(DEMO_THEME_KEY, JSON.stringify(resolveTheme(theme)));
  else storage.removeItem(DEMO_THEME_KEY);
}

export type GlassPreference = "auto" | "off";
export type GlassMode = "full" | "lite" | "off";

export function glassModeFor(preference: string | null, deviceMemoryGb: number | undefined): GlassMode {
  if (preference === "off") return "off";
  return deviceMemoryGb !== undefined && deviceMemoryGb <= LOW_MEMORY_GB ? "lite" : "full";
}

export function readGlassPreference(storage: KeyValueStorage): GlassPreference {
  try { return storage.getItem(GLASS_KEY) === "off" ? "off" : "auto"; } catch { return "auto"; }
}

export function writeGlassPreference(storage: KeyValueStorage, preference: GlassPreference): void {
  try { if (preference === "off") storage.setItem(GLASS_KEY, "off"); else storage.removeItem(GLASS_KEY); } catch { /* penyimpanan diblokir: pilihan berlaku sampai halaman dimuat ulang */ }
}

export function applyGlassMode(mode: GlassMode): void {
  if (mode === "full") delete document.documentElement.dataset.glass;
  else document.documentElement.dataset.glass = mode;
}
