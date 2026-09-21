import { tooManyRequests } from "./errors";
import { createRateLimiter, type RateLimitConfig, type RateLimiter } from "./rate-limit";

/**
 * Konfigurasi limiter bernama + singleton per proses. Singleton disimpan di `globalThis` agar
 * hot-reload dev tidak mereset penghitung. Pola key (dibentuk pemanggil):
 * - LOGIN_PAIR       "login:pair:<ipKey>::<identifier>" (hanya kegagalan)
 * - LOGIN_IDENTIFIER "login:id:<identifier>"            (hanya kegagalan, tidak bergantung IP)
 * - LOGIN_IP         "login:ip:<ipKey>"                 (hanya kegagalan; tinggi karena NAT WiFi sekolah)
 * - REFRESH_IP       "refresh:<ipKey>"
 * - CHANGE_PASSWORD  "chpw:<userId>"                    (hanya password lama salah)
 * - ADMIN_RESET      "reset:<actorId>"
 * - CHECK_IN / UPLOAD / IMPORT / AD_CLICK / AD_IMPRESSION  "<nama>:<userId>"
 * `ipKey` = `rateLimitKeyForIp(clientIp(req))` (IPv6 dinormalisasi ke /64).
 */
const MINUTE_MS = 60_000;

export const RATE_LIMITS = {
  LOGIN_PAIR: { limit: 8, windowMs: 10 * MINUTE_MS, lockMs: 15 * MINUTE_MS },
  LOGIN_IDENTIFIER: { limit: 10, windowMs: 15 * MINUTE_MS, lockMs: 15 * MINUTE_MS },
  LOGIN_IP: { limit: 200, windowMs: 10 * MINUTE_MS, lockMs: 15 * MINUTE_MS },
  // Satu sekolah di balik satu IP NAT (~1.000 siswa, token 15 menit) ~70 refresh/menit.
  REFRESH_IP: { limit: 600, windowMs: MINUTE_MS },
  CHANGE_PASSWORD: { limit: 5, windowMs: 15 * MINUTE_MS, lockMs: 15 * MINUTE_MS },
  ADMIN_RESET: { limit: 30, windowMs: 60 * MINUTE_MS },
  CHECK_IN: { limit: 10, windowMs: 10 * MINUTE_MS },
  UPLOAD: { limit: 30, windowMs: 10 * MINUTE_MS },
  IMPORT: { limit: 10, windowMs: 60 * MINUTE_MS },
  AD_CLICK: { limit: 10, windowMs: MINUTE_MS },
  AD_IMPRESSION: { limit: 30, windowMs: MINUTE_MS },
} as const satisfies Record<string, RateLimitConfig>;

export type RateLimitName = keyof typeof RATE_LIMITS;

type Registry = Map<RateLimitName, RateLimiter>;
const REGISTRY_KEY = "__studenthubRateLimiters";
const globalStore = globalThis as typeof globalThis & { [REGISTRY_KEY]?: Registry };

function registry(): Registry {
  globalStore[REGISTRY_KEY] ??= new Map<RateLimitName, RateLimiter>();
  return globalStore[REGISTRY_KEY];
}

/** Limiter singleton untuk nama tertentu (dibuat malas saat pertama dipakai). */
export function getLimiter(name: RateLimitName): RateLimiter {
  const limiters = registry();
  const existing = limiters.get(name);
  if (existing !== undefined) return existing;
  const created = createRateLimiter(RATE_LIMITS[name]);
  limiters.set(name, created);
  return created;
}

/**
 * Memeriksa limiter dan melempar 429 `RATE_LIMITED` (+ header Retry-After) bila key terblokir.
 * Tidak menghitung percobaan — panggil `hit`/`recordFailure` secara terpisah sesuai semantik limiter.
 */
export function assertRateLimit(name: RateLimitName, key: string): void {
  const decision = getLimiter(name).check(key);
  if (!decision.ok) throw tooManyRequests(decision.retryAfterSeconds);
}

/** Hanya untuk test: kosongkan semua limiter (referensi yang sudah dipegang pemanggil ikut kosong). */
export function resetAllLimiters(): void {
  for (const limiter of registry().values()) limiter.clear();
}
