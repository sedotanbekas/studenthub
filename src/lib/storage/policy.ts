import type { FileKind, UserRole } from "@prisma/client";
import { forbidden } from "@/lib/http/errors";

/**
 * Kebijakan unggah per jenis berkas (murni). Hanya gambar JPEG/PNG/WebP — tanpa PDF (keputusan PLAN).
 * Semua gambar di-re-encode; metadata (EXIF/GPS) tidak pernah ikut tersimpan.
 */
const MIB = 1024 * 1024;

/** Batas piksel input (lebar × tinggi) untuk semua jenis; juga dipakai sebagai limitInputPixels sharp. */
export const MAX_INPUT_PIXELS = 25_000_000;

export interface JpegProfile {
  readonly type: "jpeg";
  readonly quality: number;
  /** Sisi terpanjang output (fit inside, tanpa memperbesar). */
  readonly maxSide: number;
  /** Sisi terpendek input minimum setelah orientasi (0 = tanpa batas). */
  readonly minShortSide: number;
}

export interface BannerProfile {
  readonly type: "banner";
  readonly quality: number;
  /** Output WebP tepat width × height (fit cover). */
  readonly width: number;
  readonly height: number;
  readonly minWidth: number;
  readonly minHeight: number;
  /** Rasio lebar:tinggi = aspectWidth:aspectHeight, toleransi ± aspectTolerancePct persen. */
  readonly aspectWidth: number;
  readonly aspectHeight: number;
  readonly aspectTolerancePct: number;
}

export type ImageProfile = JpegProfile | BannerProfile;

export interface UploadPolicy {
  readonly roles: readonly UserRole[];
  readonly maxInputBytes: number;
  readonly profile: ImageProfile;
}

const PROOF_PROFILE: JpegProfile = Object.freeze({ type: "jpeg", quality: 85, maxSide: 2000, minShortSide: 0 });

export const BANNER_PROFILE: BannerProfile = Object.freeze({
  type: "banner",
  quality: 82,
  width: 1200,
  height: 600,
  minWidth: 800,
  minHeight: 400,
  aspectWidth: 2,
  aspectHeight: 1,
  aspectTolerancePct: 2,
});

export const UPLOAD_POLICY: Readonly<Record<FileKind, UploadPolicy>> = Object.freeze({
  ATTENDANCE_SELFIE: Object.freeze({
    roles: Object.freeze(["STUDENT"] as const),
    maxInputBytes: 5 * MIB,
    profile: Object.freeze({ type: "jpeg", quality: 70, maxSide: 640, minShortSide: 240 } as const),
  }),
  LEAVE_ATTACHMENT: Object.freeze({ roles: Object.freeze(["STUDENT"] as const), maxInputBytes: 8 * MIB, profile: PROOF_PROFILE }),
  PAYMENT_PROOF: Object.freeze({ roles: Object.freeze(["STUDENT"] as const), maxInputBytes: 8 * MIB, profile: PROOF_PROFILE }),
  TOPUP_PROOF: Object.freeze({ roles: Object.freeze(["SPONSOR"] as const), maxInputBytes: 8 * MIB, profile: PROOF_PROFILE }),
  AD_BANNER: Object.freeze({ roles: Object.freeze(["SPONSOR"] as const), maxInputBytes: 5 * MIB, profile: BANNER_PROFILE }),
});

export function assertCanUpload(role: UserRole, kind: FileKind): void {
  if (!UPLOAD_POLICY[kind].roles.includes(role)) {
    throw forbidden("FORBIDDEN", "Anda tidak berhak mengunggah jenis berkas ini.");
  }
}

export type BannerReason = "FORMAT" | "ANIMATED" | "TOO_SMALL" | "ASPECT" | "PIXELS";

export interface BannerMeta {
  /** Nama format dari decoder sharp (jpeg, png, webp, gif, svg, heif, ...). */
  readonly format: string;
  readonly width: number;
  readonly height: number;
  readonly pages?: number | undefined;
}

const BANNER_FORMATS: ReadonlySet<string> = new Set(["jpeg", "png", "webp"]);

/** Aturan banner murni. Rasio dihitung dengan bilangan bulat agar batas toleransi tepat (tanpa galat float). */
export function checkBannerMeta(meta: BannerMeta, profile: BannerProfile = BANNER_PROFILE): BannerReason | null {
  if (!BANNER_FORMATS.has(meta.format)) return "FORMAT";
  if ((meta.pages ?? 1) > 1) return "ANIMATED";
  if (meta.width * meta.height > MAX_INPUT_PIXELS) return "PIXELS";
  if (meta.width < profile.minWidth || meta.height < profile.minHeight) return "TOO_SMALL";
  // |w/h − a/b| / (a/b) ≤ t/100  ⇔  100·|w·b − a·h| ≤ t·a·h
  const deviation = Math.abs(meta.width * profile.aspectHeight - profile.aspectWidth * meta.height);
  if (100 * deviation > profile.aspectTolerancePct * profile.aspectWidth * meta.height) return "ASPECT";
  return null;
}
