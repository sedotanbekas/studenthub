import { AppError, isAppError, unprocessable } from "@/lib/http/errors";
import { log, safeErrorFields } from "@/lib/log";
import { imageSemaphore, sharp, SHARP_INPUT } from "@/lib/storage/sharp-runtime";
import { assertAllowedImage, sniffImage } from "@/lib/storage/sniff";
import { maskGeometry, type IconVariant, type MaskGeometry } from "./icon-rules";
import { checkLogoMeta, LOGO_MAX_INPUT_BYTES, LOGO_MAX_SIDE, LOGO_MESSAGES } from "./rules";

/**
 * Logo aplikasi: magic bytes -> metadata -> aturan logo -> orientasi -> perkecil (sisi terpanjang <= 512 px, tanpa
 * memperbesar) -> WebP dengan transparansi tetap, TANPA metadata. Hanya piksel hasil decode yang ditulis ulang.
 */
export interface ProcessedLogo {
  readonly data: Buffer;
  readonly mimeType: "image/webp";
  readonly width: number;
  readonly height: number;
}

function unreadable(err: unknown): AppError {
  if (isAppError(err)) return err;
  log.info("app_settings.logo_unreadable", safeErrorFields(err));
  return unprocessable("IMAGE_UNREADABLE", "Gambar tidak dapat dibaca.");
}

async function assertLogoRules(bytes: Uint8Array): Promise<void> {
  let meta;
  try {
    meta = await sharp(bytes, { failOn: "error", limitInputPixels: false }).metadata();
  } catch (err) {
    throw unreadable(err);
  }
  const reason = checkLogoMeta({ format: meta.format, width: meta.autoOrient.width, height: meta.autoOrient.height, pages: meta.pages });
  if (reason) throw unprocessable("LOGO_INVALID", LOGO_MESSAGES[reason], { reason });
}

export async function processLogo(bytes: Uint8Array): Promise<ProcessedLogo> {
  if (bytes.byteLength > LOGO_MAX_INPUT_BYTES) {
    throw new AppError(413, "PAYLOAD_TOO_LARGE", "Ukuran logo maksimal 2 MB.", { maxBytes: LOGO_MAX_INPUT_BYTES });
  }
  assertAllowedImage(await sniffImage(bytes));
  return imageSemaphore.run(async () => {
    await assertLogoRules(bytes);
    try {
      const { data, info } = await sharp(bytes, SHARP_INPUT)
        .autoOrient()
        .resize({ width: LOGO_MAX_SIDE, height: LOGO_MAX_SIDE, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 90, alphaQuality: 100 })
        .toBuffer({ resolveWithObject: true });
      return { data, mimeType: "image/webp", width: info.width, height: info.height };
    } catch (err) {
      throw unreadable(err);
    }
  });
}

/** Kanvas persegi varian ikon dari logo tersimpan: logo di tengah (sisi terpanjang = ratio × sisi kanvas). */
export async function renderIcon(logo: Uint8Array, v: IconVariant): Promise<Buffer> {
  const inner = Math.max(1, Math.round(v.size * v.ratio));
  const { data, info } = await sharp(logo, SHARP_INPUT).resize({ width: inner, height: inner, fit: "inside" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // Badge notifikasi: siluet putih (Android hanya memakai kanal alfa).
  if (v.silhouette) for (let i = 0; i < data.length; i += 4) { data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = data[i + 3]! >= 90 ? 255 : 0; }
  const mark = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  const canvas = sharp({ create: { width: v.size, height: v.size, channels: 4, background: v.background ?? { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: mark, left: Math.floor((v.size - info.width) / 2), top: Math.floor((v.size - info.height) / 2) }]);
  const flat = v.background ? canvas.flatten({ background: v.background }) : canvas;
  return v.format === "webp" ? flat.webp({ quality: 90, alphaQuality: 100 }).toBuffer() : flat.png({ compressionLevel: 9 }).toBuffer();
}

const GEOMETRY_GRID = 64;

/** Geometri masker splash dari kanvas splash (alfa diperkecil ke 64×64). */
export async function splashMaskGeometry(splash: Uint8Array): Promise<MaskGeometry | null> {
  const alpha = await sharp(splash).resize(GEOMETRY_GRID, GEOMETRY_GRID, { fit: "fill" }).ensureAlpha().extractChannel(3).raw().toBuffer();
  return maskGeometry(new Uint8Array(alpha), GEOMETRY_GRID);
}
