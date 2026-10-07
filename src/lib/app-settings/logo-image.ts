import { AppError, isAppError, unprocessable } from "@/lib/http/errors";
import { log, safeErrorFields } from "@/lib/log";
import { imageSemaphore, sharp, SHARP_INPUT } from "@/lib/storage/sharp-runtime";
import { assertAllowedImage, sniffImage } from "@/lib/storage/sniff";
import { checkLogoMeta, LOGO_MAX_INPUT_BYTES, LOGO_MAX_SIDE, LOGO_MESSAGES } from "./rules";

/**
 * Logo aplikasi: magic bytes -> metadata -> aturan logo -> orientasi -> perkecil (sisi terpanjang <= 256 px, tanpa
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
