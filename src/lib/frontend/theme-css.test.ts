import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_THEME, themeVariables } from "@/lib/schools/theme-rules";

/** Nilai bawaan di globals.css dipakai sebelum/tanpa tema sekolah (login, sponsor, super admin): harus sama dengan turunan resmi. */
test("token tema bawaan di :root globals.css sama persis dengan themeVariables(DEFAULT_THEME)", () => {
  const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  const root = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
  const declared = Object.fromEntries([...root.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-f]{6});/g)].map(m => [m[1], m[2]]));
  for (const [name, value] of Object.entries(themeVariables(DEFAULT_THEME))) assert.equal(declared[name], value, name);
});
