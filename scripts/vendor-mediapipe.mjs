// Salin runtime WASM MediaPipe (deteksi wajah absensi) ke public/vendor/mediapipe agar dilayani dari
// domain sendiri (tanpa CDN pihak ketiga). Berkas ~12 MB per varian sehingga tidak di-commit; dijalankan
// otomatis oleh `postinstall` dan `build`. Model wajah (kecil) di-commit di public/models.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const target = join(process.cwd(), "public", "vendor", "mediapipe");
const FILES = ["vision_wasm_internal.js", "vision_wasm_internal.wasm", "vision_wasm_nosimd_internal.js", "vision_wasm_nosimd_internal.wasm"];

mkdirSync(target, { recursive: true });
// Glue JS hasil Emscripten milik pihak ketiga: ditandai agar tidak ikut aturan lint proyek.
const LINT_OFF = "/* eslint-disable */ // Salinan vendor @mediapipe/tasks-vision — jangan diedit.\n";
for (const file of FILES) {
  const from = require.resolve(`@mediapipe/tasks-vision/${file}`);
  if (file.endsWith(".js")) writeFileSync(join(target, file), LINT_OFF + readFileSync(from, "utf8"));
  else copyFileSync(from, join(target, file));
}
console.log(`MediaPipe WASM disalin ke ${target}`);
