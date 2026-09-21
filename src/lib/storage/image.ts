import { createHash } from "node:crypto";
import type { FileKind } from "@prisma/client";
import { AppError, isAppError, unprocessable } from "@/lib/http/errors";
import { log, safeErrorFields } from "@/lib/log";
import type { StorageExt } from "./keys";
import { dHash } from "./phash";
import {
  checkBannerMeta, MAX_INPUT_PIXELS, UPLOAD_POLICY,
  type BannerProfile, type BannerReason, type ImageProfile, type JpegProfile,
} from "./policy";
import { imageSemaphore, sharp, SHARP_INPUT, type Sharp } from "./sharp-runtime";
import { assertAllowedImage, sniffImage } from "./sniff";

/**
 * Pipeline gambar tunggal: batas ukuran → magic bytes → metadata → aturan per jenis → orientasi →
 * resize → encode ulang TANPA metadata (EXIF/GPS/XMP/ICC dibuang). Hanya piksel hasil decode yang
 * ditulis ulang, sehingga payload poliglot (HTML/ZIP yang ditempel) tidak pernah tersimpan.
 */
export interface ProcessedImage {
  readonly data: Buffer;
  readonly mimeType: string;
  readonly ext: StorageExt;
  readonly width: number;
  readonly height: number;
  readonly sizeBytes: number;
  /** sha256 atas byte OUTPUT (yang disimpan). */
  readonly sha256: string;
  /** dHash atas byte OUTPUT. */
  readonly phash: string;
}

interface ImageMeta {
  readonly format: string;
  /** Dimensi setelah orientasi EXIF diterapkan. */
  readonly width: number;
  readonly height: number;
  readonly pages: number | undefined;
}

const DECODABLE_FORMATS: ReadonlySet<string> = new Set(["jpeg", "png", "webp"]);

const BANNER_MESSAGES: Readonly<Record<BannerReason, string>> = Object.freeze({
  FORMAT: "Banner harus berupa gambar JPEG, PNG, atau WebP.",
  ANIMATED: "Banner animasi tidak didukung.",
  TOO_SMALL: "Banner minimal 800×400 piksel.",
  ASPECT: "Rasio banner harus 2:1 (mis. 1200×600).",
  PIXELS: "Resolusi banner terlalu besar (maksimal 25 megapiksel).",
});

function unreadable(err: unknown): AppError {
  if (isAppError(err)) return err;
  log.info("storage.image_unreadable", safeErrorFields(err));
  return unprocessable("IMAGE_UNREADABLE", "Gambar tidak dapat dibaca.");
}

async function readMeta(bytes: Uint8Array): Promise<ImageMeta> {
  try {
    // Hanya header yang dibaca; batas piksel diperiksa eksplisit agar galatnya spesifik.
    const m = await sharp(bytes, { failOn: "error", limitInputPixels: false }).metadata();
    return { format: m.format, width: m.autoOrient.width, height: m.autoOrient.height, pages: m.pages };
  } catch (err) {
    throw unreadable(err);
  }
}

function assertBannerRules(meta: ImageMeta, profile: BannerProfile): void {
  const reason = checkBannerMeta(meta, profile);
  if (reason) throw unprocessable("BANNER_INVALID", BANNER_MESSAGES[reason], { reason });
}

function assertJpegRules(meta: ImageMeta, profile: JpegProfile): void {
  if (!DECODABLE_FORMATS.has(meta.format)) {
    throw new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "Unggah foto JPEG, PNG, atau WebP.");
  }
  if (meta.width * meta.height > MAX_INPUT_PIXELS) {
    throw unprocessable("IMAGE_TOO_LARGE", "Resolusi gambar terlalu besar (maksimal 25 megapiksel).");
  }
  if (Math.min(meta.width, meta.height) < profile.minShortSide) {
    throw unprocessable("IMAGE_TOO_SMALL", `Foto terlalu kecil. Sisi terpendek minimal ${profile.minShortSide} piksel.`, {
      minShortSide: profile.minShortSide,
    });
  }
}

function buildPipeline(bytes: Uint8Array, profile: ImageProfile): Sharp {
  const oriented = sharp(bytes, SHARP_INPUT).autoOrient();
  if (profile.type === "banner") {
    return oriented
      .resize(profile.width, profile.height, { fit: "cover", position: "centre" })
      .webp({ quality: profile.quality });
  }
  return oriented
    .resize({ width: profile.maxSide, height: profile.maxSide, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: profile.quality });
}

async function encode(bytes: Uint8Array, profile: ImageProfile): Promise<{ data: Buffer; width: number; height: number }> {
  try {
    const { data, info } = await buildPipeline(bytes, profile).toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch (err) {
    throw unreadable(err);
  }
}

function assertInputSize(bytes: Uint8Array, maxBytes: number): void {
  if (bytes.byteLength <= maxBytes) return;
  const mb = Math.floor(maxBytes / (1024 * 1024));
  throw new AppError(413, "PAYLOAD_TOO_LARGE", `Ukuran berkas maksimal ${mb} MB.`, { maxBytes });
}

export async function processImage(bytes: Uint8Array, kind: FileKind): Promise<ProcessedImage> {
  const { maxInputBytes, profile } = UPLOAD_POLICY[kind];
  assertInputSize(bytes, maxInputBytes);
  assertAllowedImage(await sniffImage(bytes));
  return imageSemaphore.run(async () => {
    const meta = await readMeta(bytes);
    if (profile.type === "banner") assertBannerRules(meta, profile);
    else assertJpegRules(meta, profile);
    const out = await encode(bytes, profile);
    const isBanner = profile.type === "banner";
    return {
      data: out.data,
      mimeType: isBanner ? "image/webp" : "image/jpeg",
      ext: isBanner ? "webp" : "jpg",
      width: out.width,
      height: out.height,
      sizeBytes: out.data.length,
      sha256: createHash("sha256").update(out.data).digest("hex"),
      phash: await dHash(out.data),
    };
  });
}
