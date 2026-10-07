import { MAX_INPUT_PIXELS } from "@/lib/storage/policy";

/**
 * Aturan murni identitas aplikasi (menu Pengaturan aplikasi, pemilik 2026-10-07), tanpa Prisma: nama aplikasi
 * yang tampil di sidebar/halaman masuk/judul tab, dan logo unggahan super admin.
 */
export const DEFAULT_APP_NAME = "Student Hub";
export const APP_NAME_MIN = 2;
export const APP_NAME_MAX = 40;
/** Logo disimpan WebP dengan sisi terpanjang <= 512 px: sumber ikon PWA 512 px & splash tetap tajam. */
export const LOGO_MAX_SIDE = 512;
export const LOGO_MIN_SIDE = 64;
export const LOGO_MAX_INPUT_BYTES = 2 * 1024 * 1024;
export const LOGO_PATH = "/api/v1/app/logo";

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** Nama rapi (spasi/baris baru dirapatkan) atau null bila tidak layak tampil. */
export function normalizeAppName(input: string): string | null {
  if (CONTROL.test(input) || /[<>]/.test(input)) return null;
  const name = input.replace(/\s+/g, " ").trim();
  return name.length >= APP_NAME_MIN && name.length <= APP_NAME_MAX ? name : null;
}

export type LogoReason = "FORMAT" | "ANIMATED" | "TOO_SMALL" | "PIXELS";

export interface LogoMeta {
  readonly format: string;
  readonly width: number;
  readonly height: number;
  readonly pages?: number | undefined;
}

const LOGO_FORMATS: ReadonlySet<string> = new Set(["jpeg", "png", "webp"]);

export function checkLogoMeta(meta: LogoMeta): LogoReason | null {
  if (!LOGO_FORMATS.has(meta.format)) return "FORMAT";
  if ((meta.pages ?? 1) > 1) return "ANIMATED";
  if (meta.width * meta.height > MAX_INPUT_PIXELS) return "PIXELS";
  if (Math.min(meta.width, meta.height) < LOGO_MIN_SIDE) return "TOO_SMALL";
  return null;
}

export const LOGO_MESSAGES: Readonly<Record<LogoReason, string>> = Object.freeze({
  FORMAT: "Logo harus berupa gambar JPEG, PNG, atau WebP.",
  ANIMATED: "Logo animasi tidak didukung.",
  TOO_SMALL: `Logo minimal ${LOGO_MIN_SIDE}×${LOGO_MIN_SIDE} piksel.`,
  PIXELS: "Resolusi logo terlalu besar (maksimal 25 megapiksel).",
});

/** URL publik logo; `v` = waktu ubah agar cache browser langsung berganti saat logo diganti. */
export function logoUrlFor(logoUpdatedAt: Date | null): string | null {
  return logoUpdatedAt ? `${LOGO_PATH}?v=${logoUpdatedAt.getTime()}` : null;
}

/** Judul tab & nama PWA: nama aplikasi + apa isinya (pemilik 2026-10-07). */
export const appTitle = (name: string): string => `${name} - Absensi, Rapor & Tagihan Sekolah`;

/**
 * Bagian nama untuk logo kata: kata terakhir berwarna aksen. Nama bawaan tetap "Student" + "Hub" menempel
 * (logo kata StudentHub seperti semula); nama lain mempertahankan spasinya.
 */
export function splitBrandName(name: string): { head: string; tail: string } {
  if (name === DEFAULT_APP_NAME) return { head: "Student", tail: "Hub" };
  const cut = name.lastIndexOf(" ");
  return cut <= 0 ? { head: name, tail: "" } : { head: name.slice(0, cut + 1), tail: name.slice(cut + 1) };
}
