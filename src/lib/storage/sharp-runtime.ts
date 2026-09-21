import sharp, { type SharpOptions } from "sharp";
import { MAX_INPUT_PIXELS } from "./policy";
import { createSemaphore } from "./semaphore";

/**
 * Konfigurasi sharp tunggal untuk modul storage: tanpa cache libvips (hemat memori pada proses PM2
 * tunggal), 2 thread libvips per gambar, dan maksimal 4 pipeline gambar berjalan bersamaan.
 */
sharp.cache(false);
sharp.concurrency(2);

export const IMAGE_PIPELINE_CONCURRENCY = 4;
export const imageSemaphore = createSemaphore(IMAGE_PIPELINE_CONCURRENCY);

/** Opsi input untuk decode penuh: batas piksel + gagal pada data rusak/terpotong. */
export const SHARP_INPUT: Readonly<SharpOptions> = Object.freeze({
  limitInputPixels: MAX_INPUT_PIXELS,
  failOn: "error",
});

export { sharp };
export type { Sharp } from "sharp";
