import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_THEME,
  THEME_KEYS,
  THEME_PRESETS,
  contrastRatio,
  inkFor,
  mixHex,
  normalizeHex,
  readableText,
  resolveTheme,
  sameTheme,
  themeVariables,
} from "./theme-rules";

test("normalizeHex menerima #RGB / #RRGGBB (huruf besar/kecil) dan menolak selain itu", () => {
  assert.equal(normalizeHex("#1D4ED8"), "#1d4ed8");
  assert.equal(normalizeHex("  #abc "), "#aabbcc");
  assert.equal(normalizeHex("1d4ed8"), null);
  assert.equal(normalizeHex("#12345"), null);
  assert.equal(normalizeHex("#gggggg"), null);
  assert.equal(normalizeHex("red"), null);
  assert.equal(normalizeHex(""), null);
});

test("rasio kontras WCAG: hitam/putih 21, warna sama 1, simetris", () => {
  assert.equal(Math.round(contrastRatio("#000000", "#ffffff") * 10) / 10, 21);
  assert.equal(contrastRatio("#1d4ed8", "#1d4ed8"), 1);
  assert.equal(contrastRatio("#1d4ed8", "#ffffff"), contrastRatio("#ffffff", "#1d4ed8"));
  assert.ok(contrastRatio("#1d4ed8", "#ffffff") > 6);
});

test("mixHex mencampur linear per kanal; bobot 0 = warna awal, 1 = warna kedua", () => {
  assert.equal(mixHex("#000000", "#ffffff", 0), "#000000");
  assert.equal(mixHex("#000000", "#ffffff", 1), "#ffffff");
  assert.equal(mixHex("#000000", "#ffffff", 0.5), "#808080");
  assert.equal(mixHex("#ff0000", "#0000ff", 0.25), "#bf0040");
});

test("readableText memilih teks putih di atas warna gelap dan teks gelap di atas warna terang", () => {
  assert.equal(readableText("#1d4ed8"), "#ffffff");
  assert.equal(readableText("#1e3a8a"), "#ffffff");
  assert.equal(readableText("#facc15"), "#0b1220");
  assert.equal(readableText("#ffffff"), "#0b1220");
});

test("inkFor menggelapkan warna terang sampai kontras minimal tercapai, warna gelap dibiarkan", () => {
  assert.equal(inkFor("#1e3a8a", "#ffffff", 4.5), "#1e3a8a");
  const yellow = inkFor("#facc15", "#ffffff", 4.5);
  assert.ok(contrastRatio(yellow, "#ffffff") >= 4.5, `kontras ${contrastRatio(yellow, "#ffffff")}`);
  const strict = inkFor("#38bdf8", "#ffffff", 7);
  assert.ok(contrastRatio(strict, "#ffffff") >= 7);
});

test("resolveTheme: null/kosong -> tema bawaan; nilai tak valid diganti bawaan per kunci", () => {
  assert.deepEqual(resolveTheme(null), DEFAULT_THEME);
  assert.deepEqual(resolveTheme(undefined), DEFAULT_THEME);
  const partial = resolveTheme({ primaryColor: "#B91C1C", bannerColor: "bukan-warna", logoColor: null });
  assert.equal(partial.primaryColor, "#b91c1c");
  assert.equal(partial.bannerColor, DEFAULT_THEME.bannerColor);
  assert.equal(partial.logoColor, DEFAULT_THEME.logoColor);
  assert.equal(partial.secondaryColor, DEFAULT_THEME.secondaryColor);
});

test("sameTheme membandingkan kelima warna tanpa peduli huruf besar/kecil", () => {
  assert.equal(sameTheme(DEFAULT_THEME, { ...DEFAULT_THEME, primaryColor: DEFAULT_THEME.primaryColor.toUpperCase() }), true);
  assert.equal(sameTheme(DEFAULT_THEME, { ...DEFAULT_THEME, logoColor: "#000000" }), false);
});

test("themeVariables menghasilkan token CSS lengkap dengan teks yang selalu terbaca", () => {
  const vars = themeVariables({ ...DEFAULT_THEME, primaryColor: "#facc15", bannerColor: "#fde68a", logoColor: "#ffffff" });
  for (const name of ["--primary", "--primary-hover", "--primary-ink", "--primary-soft", "--on-primary", "--secondary", "--secondary-soft", "--secondary-ink", "--on-secondary", "--banner", "--banner-2", "--on-banner", "--animation", "--animation-soft", "--logo", "--on-logo"]) {
    assert.ok(/^#[0-9a-f]{6}$/.test(vars[name] ?? ""), `${name} = ${vars[name]}`);
  }
  assert.ok(contrastRatio(vars["--on-primary"]!, vars["--primary"]!) >= 4.5);
  assert.ok(contrastRatio(vars["--on-primary"]!, vars["--primary-hover"]!) >= 4.5);
  assert.ok(contrastRatio(vars["--primary-ink"]!, "#ffffff") >= 7);
  assert.ok(contrastRatio(vars["--primary-ink"]!, vars["--primary-soft"]!) >= 4.5);
  assert.ok(contrastRatio(vars["--secondary-ink"]!, vars["--secondary-soft"]!) >= 4.5);
  assert.ok(contrastRatio(vars["--on-banner"]!, vars["--banner"]!) >= 4.5);
  assert.ok(contrastRatio(vars["--on-banner"]!, vars["--banner-2"]!) >= 4.5);
  assert.ok(contrastRatio(vars["--on-logo"]!, vars["--logo"]!) >= 4.5);
});

test("semua preset valid, unik, dan tombolnya terbaca", () => {
  assert.ok(THEME_PRESETS.length >= 6);
  assert.equal(new Set(THEME_PRESETS.map(p => p.key)).size, THEME_PRESETS.length);
  assert.ok(sameTheme(THEME_PRESETS[0]!.colors, DEFAULT_THEME), "preset pertama = tema bawaan");
  for (const preset of THEME_PRESETS) {
    for (const key of THEME_KEYS) assert.equal(normalizeHex(preset.colors[key]), preset.colors[key], `${preset.key}.${key}`);
    const vars = themeVariables(preset.colors);
    assert.ok(contrastRatio(vars["--on-primary"]!, vars["--primary"]!) >= 4.5, preset.key);
  }
});

test("teks sekunder di atas banner (--on-banner-muted) tetap terbaca di kedua ujung gradien", () => {
  for (const preset of THEME_PRESETS) {
    const vars = themeVariables(preset.colors);
    assert.ok(contrastRatio(vars["--on-banner-muted"]!, vars["--banner"]!) >= 4.5, `${preset.key} banner`);
    assert.ok(contrastRatio(vars["--on-banner-muted"]!, vars["--banner-2"]!) >= 4.5, `${preset.key} banner-2`);
  }
  const light = themeVariables({ ...DEFAULT_THEME, bannerColor: "#fde68a" });
  assert.ok(contrastRatio(light["--on-banner-muted"]!, light["--banner"]!) >= 4.5);
});

test("kanvas bergradasi tema (dua blob 15% bertumpuk) tetap kontras untuk teks isi di semua preset", () => {
  const BG = "#eef2f7"; const INK_2 = "#1e293b"; const MUTED = "#475569";
  for (const preset of THEME_PRESETS) {
    const { bannerColor, secondaryColor, animationColor } = preset.colors;
    const darkest = [bannerColor, secondaryColor, animationColor].sort((a, b) => contrastRatio(b, "#ffffff") - contrastRatio(a, "#ffffff"))[0]!;
    const canvas = mixHex(BG, darkest, 1 - 0.85 ** 2);
    assert.ok(contrastRatio(INK_2, canvas) >= 4.5, `${preset.key}: ink-2 di kanvas`);
    assert.ok(contrastRatio(MUTED, mixHex(canvas, "#ffffff", 0.74)) >= 4.5, `${preset.key}: muted di kartu kaca`);
  }
});

test("--primary-line (garis/indikator non-teks) selalu >= 3:1 di atas putih, termasuk primer terang", () => {
  for (const colors of [...THEME_PRESETS.map(p => p.colors), { ...DEFAULT_THEME, primaryColor: "#facc15" }, { ...DEFAULT_THEME, primaryColor: "#ffffff" }]) {
    const vars = themeVariables(colors);
    assert.match(vars["--primary-line"] ?? "", /^#[0-9a-f]{6}$/);
    assert.ok(contrastRatio(vars["--primary-line"]!, "#ffffff") >= 3, `${colors.primaryColor} -> ${vars["--primary-line"]}`);
  }
});
