import { isForbiddenScheme } from "@/lib/ads/link-rules";
import type { AdLinkType } from "./ad-types";

/**
 * Aturan murni slot iklan siswa (tanpa DOM): antrean impresi (batas API 20 token per kirim, tanpa
 * duplikat di satu halaman), jenis perangkat untuk laporan klik, dan pemeriksaan ulang tautan tujuan.
 */
export const IMPRESSION_BATCH_MAX = 20;
/** Impresi dihitung setelah >= 50% kartu terlihat selama 1 detik (standar tayangan yang wajar). */
export const VISIBLE_RATIO = 0.5;
export const VISIBLE_MS = 1_000;
/** Kirim impresi berkala (limit API 30 permintaan/menit per siswa). */
export const IMPRESSION_FLUSH_MS = 4_000;
/** Pergantian kartu otomatis; berhenti selamanya begitu siswa menyentuh slot. */
export const ROTATE_MS = 7_000;

export function enqueueImpression(queue: readonly string[], sent: ReadonlySet<string>, token: string): string[] {
  return queue.includes(token) || sent.has(token) ? [...queue] : [...queue, token];
}

export function takeBatch(queue: readonly string[]): { batch: string[]; rest: string[] } {
  return { batch: queue.slice(0, IMPRESSION_BATCH_MAX), rest: queue.slice(IMPRESSION_BATCH_MAX) };
}

/** Galat pengiriman impresi yang layak dicoba ulang (server mendedupe, jadi kirim ulang aman); galat validasi/izin dibuang. */
const DROP_IMPRESSION_CODES = new Set(["VALIDATION_FAILED", "UNSUPPORTED_MEDIA_TYPE", "FORBIDDEN", "STUDENT_NOT_ACTIVE", "PASSWORD_CHANGE_REQUIRED", "PAYLOAD_TOO_LARGE"]);
export function isRetryableImpressionError(code: string | null): boolean {
  return code === null || !DROP_IMPRESSION_CODES.has(code);
}

const REFRESH_MIN_S = 60;
const REFRESH_MAX_S = 30 * 60;
/**
 * Jeda muat ulang daftar iklan: jadwal dari server (`refreshAfterSeconds`) bila sukses; setelah gagal
 * ke-n mundur bertahap 60 s, 120 s, ... sampai 30 menit.
 */
export function refreshDelaySeconds(serverSeconds: number | null, failures: number): number {
  if (failures > 0) return Math.min(REFRESH_MAX_S, REFRESH_MIN_S * 2 ** (failures - 1));
  return Math.min(REFRESH_MAX_S, Math.max(REFRESH_MIN_S, serverSeconds ?? REFRESH_MAX_S));
}

export type DeviceType = "MOBILE" | "TABLET" | "DESKTOP";
/** `touchPoints` = navigator.maxTouchPoints: iPadOS 13+ mengaku "Macintosh" tetapi punya layar sentuh. */
export function deviceTypeOf(userAgent: string, width: number, touchPoints = 0): DeviceType {
  if (/iPad|Tablet/i.test(userAgent) || (/Android/i.test(userAgent) && !/Mobile/i.test(userAgent))) return "TABLET";
  if (/Macintosh/i.test(userAgent) && touchPoints > 1) return "TABLET";
  if (/Mobi|iPhone|iPod|Android/i.test(userAgent)) return "MOBILE";
  return width < 768 ? "MOBILE" : "DESKTOP";
}

/**
 * Tautan tujuan dari server diperiksa ulang sebelum dibuka: tautan luar wajib https; deep link boleh
 * skema aplikasi, tetapi skema terlarang (daftar yang sama dengan server) selalu ditolak. Mengembalikan
 * bentuk kanonik; null = jangan buka apa pun.
 */
export function safeTargetUrl(url: string | null, linkType: AdLinkType): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (linkType === "EXTERNAL_URL") return parsed.protocol === "https:" ? parsed.href : null;
  return isForbiddenScheme(parsed.protocol.slice(0, -1)) ? null : parsed.href;
}

export function wrapIndex(current: number, count: number, step: number): number {
  if (count <= 0) return 0;
  return (((current + step) % count) + count) % count;
}
