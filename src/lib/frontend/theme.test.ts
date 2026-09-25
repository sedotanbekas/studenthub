import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_THEME, themeVariables } from "@/lib/schools/theme-rules";
import { glassModeFor, readDemoTheme, themeStyleEntries, writeDemoTheme } from "./theme";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), data };
}

test("themeStyleEntries: tema -> semua token terpasang; null -> semua token dihapus (kembali ke CSS bawaan)", () => {
  const names = Object.keys(themeVariables(DEFAULT_THEME));
  const applied = themeStyleEntries({ ...DEFAULT_THEME, primaryColor: "#B91C1C" });
  assert.deepEqual(applied.map(([name]) => name), names);
  assert.ok(applied.every(([, value]) => typeof value === "string" && /^#[0-9a-f]{6}$/.test(value)));
  assert.equal(new Map(applied).get("--primary"), "#b91c1c");
  const cleared = themeStyleEntries(null);
  assert.deepEqual(cleared.map(([name]) => name), names);
  assert.ok(cleared.every(([, value]) => value === null));
});

test("tema demo disimpan per sesi; data rusak diabaikan tanpa error", () => {
  const storage = memoryStorage();
  assert.equal(readDemoTheme(storage), null);
  writeDemoTheme(storage, { ...DEFAULT_THEME, logoColor: "#ABCDEF" });
  assert.equal(readDemoTheme(storage)?.logoColor, "#abcdef");
  writeDemoTheme(storage, null);
  assert.equal(readDemoTheme(storage), null);
  assert.equal(readDemoTheme(memoryStorage({ studenthub_demo_theme: "{bukan json" })), null);
});

test("mode kaca: pilihan kontras tinggi menang; perangkat memori kecil memakai kaca ringan", () => {
  assert.equal(glassModeFor("off", 8), "off");
  assert.equal(glassModeFor("auto", 2), "lite");
  assert.equal(glassModeFor("auto", 8), "full");
  assert.equal(glassModeFor("auto", undefined), "full");
  assert.equal(glassModeFor(null, 1), "lite");
});
