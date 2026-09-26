import { parseStorageKey, type StorageExt } from "./keys";

/**
 * Berkas publik `/media/...` (hanya salinan banner iklan yang sudah disetujui). Di produksi nginx
 * melayaninya langsung dari disk; route Next `/media/[...key]` adalah cadangan (dev, atau vhost yang
 * belum punya alias `/media/`). Kunci divalidasi regex penyimpanan yang ketat — bukan path bebas.
 */
const MIME: Readonly<Record<StorageExt, string>> = { jpg: "image/jpeg", webp: "image/webp" };

export const PUBLIC_MEDIA_HEADERS = {
  "Cache-Control": "public, max-age=31536000, immutable",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
} as const;

/** Kunci penyimpanan publik dari segmen URL; null bila bukan berkas publik yang sah. */
export function publicMediaKey(segments: readonly string[]): { key: string; contentType: string } | null {
  const key = `public/${segments.join("/")}`;
  try {
    const parsed = parseStorageKey(key);
    return parsed.bucket === "public" ? { key, contentType: MIME[parsed.ext] } : null;
  } catch {
    return null;
  }
}
