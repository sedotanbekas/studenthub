import { fileTypeFromBuffer } from "file-type";
import { AppError } from "@/lib/http/errors";

/**
 * Deteksi tipe dari magic bytes (file-type), TIDAK PERNAH dari MIME/ekstensi kiriman klien.
 * file-type v22 murni ESM; di Node 24 `require(esm)` membuat import statis ini jalan di tsx (CJS) & Next.
 */
export type SniffedImage = "jpeg" | "png" | "webp" | "heic" | "unknown";
export type AllowedImage = Exclude<SniffedImage, "heic" | "unknown">;

const MIME_TO_IMAGE: Readonly<Record<string, SniffedImage>> = Object.freeze({
  "image/jpeg": "jpeg",
  "image/png": "png",
  // APNG diperlakukan sebagai PNG: re-encode hanya mengambil frame pertama (output selalu statis).
  "image/apng": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heic",
  "image/heic-sequence": "heic",
  "image/heif-sequence": "heic",
});

export async function sniffImage(bytes: Uint8Array): Promise<SniffedImage> {
  if (bytes.byteLength === 0) return "unknown";
  const result = await fileTypeFromBuffer(bytes);
  if (!result) return "unknown";
  return MIME_TO_IMAGE[result.mime] ?? "unknown";
}

export function assertAllowedImage(type: SniffedImage): asserts type is AllowedImage {
  if (type === "heic") {
    throw new AppError(415, "HEIC_NOT_SUPPORTED", "Format HEIC tidak didukung. Gunakan JPEG/PNG.");
  }
  if (type === "unknown") {
    throw new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "Unggah foto JPEG, PNG, atau WebP.");
  }
}
