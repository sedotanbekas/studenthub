/**
 * Rate limiter in-memory berjendela tetap (fixed window) per key, dengan kunci (lock) opsional.
 *
 * - `check(key)` dipanggil sebelum pekerjaan mahal; tidak pernah membuat entri baru.
 * - `hit(key)` menghitung satu percobaan; `recordFailure(key)` adalah alias untuk limiter yang hanya
 *   menghitung kegagalan (mis. login salah).
 * - Saat hitungan mencapai `limit` di dalam jendela, key dikunci sampai `now + (lockMs ?? sisa jendela)`.
 *   Bila kunci berakhir sementara jendela masih aktif, hitungan tidak direset: percobaan berikutnya
 *   langsung mengunci lagi (tidak melemahkan batas per jendela).
 * - Batas memori: map tidak pernah melampaui `maxKeys`. Saat penuh, entri yang jendela DAN kuncinya
 *   sudah berakhir disapu; key yang sedang terkunci tidak pernah dibuang. Bila masih penuh, key BARU
 *   gagal-tertutup (diblokir 60 detik) — lebih aman daripada membuang kunci aktif.
 *
 * Asumsi deploy: satu proses PM2 mode fork (state tidak dibagi antarproses).
 */

export type RateLimitConfig = {
  readonly limit: number;
  readonly windowMs: number;
  readonly lockMs?: number;
  readonly maxKeys?: number;
};

export type RateLimitDecision = { readonly ok: true } | { readonly ok: false; readonly retryAfterSeconds: number };

export type RateLimiter = {
  check(key: string): RateLimitDecision;
  hit(key: string): void;
  recordFailure(key: string): void;
  reset(key: string): void;
  /** Mengosongkan seluruh key (untuk test). */
  clear(): void;
  size(): number;
};

export const DEFAULT_MAX_KEYS = 100_000;
export const FAIL_CLOSED_RETRY_AFTER_SECONDS = 60;

type Entry = Readonly<{ count: number; windowEnd: number; lockedUntil: number | null }>;

const ALLOWED: RateLimitDecision = Object.freeze({ ok: true });

function assertPositiveInt(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Konfigurasi rate limit tidak valid: ${name} harus bilangan bulat positif.`);
  }
}

function validateConfig(config: RateLimitConfig): void {
  assertPositiveInt(config.limit, "limit");
  assertPositiveInt(config.windowMs, "windowMs");
  if (config.lockMs !== undefined) assertPositiveInt(config.lockMs, "lockMs");
  if (config.maxKeys !== undefined) assertPositiveInt(config.maxKeys, "maxKeys");
}

function expiryOf(entry: Entry): number {
  return Math.max(entry.windowEnd, entry.lockedUntil ?? 0);
}

function isLocked(entry: Entry, now: number): boolean {
  return entry.lockedUntil !== null && entry.lockedUntil > now;
}

function blocked(remainingMs: number): RateLimitDecision {
  return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)) };
}

/** Menghitung entri berikutnya setelah satu percobaan; `null` berarti tidak berubah (sedang terkunci). */
function nextEntry(entry: Entry | undefined, config: RateLimitConfig, now: number): Entry | null {
  if (entry !== undefined && isLocked(entry, now)) return null;
  const fresh = entry === undefined || expiryOf(entry) <= now;
  const windowEnd = fresh ? now + config.windowMs : entry.windowEnd;
  const count = fresh ? 1 : entry.count + 1;
  if (count < config.limit) return { count, windowEnd, lockedUntil: null };
  const lockedUntil = now + (config.lockMs ?? windowEnd - now);
  return { count, windowEnd, lockedUntil };
}

type EntryStore = {
  get(key: string): Entry | undefined;
  set(key: string, entry: Entry): void;
  delete(key: string): void;
  clear(): void;
  size(): number;
  /** Memastikan ada ruang untuk key baru; false bila tetap penuh setelah sweep. */
  hasRoomForNewKey(now: number): boolean;
};

/** Map entri berkapasitas tetap. Entri diganti utuh (tidak dimutasi); sweep hanya membuang yang kedaluwarsa. */
function createEntryStore(maxKeys: number): EntryStore {
  const entries = new Map<string, Entry>();
  // Batas bawah waktu kedaluwarsa entri mana pun: sebelum waktu ini, sweep pasti sia-sia (hemat CPU saat banjir).
  let nextSweepAt = Number.POSITIVE_INFINITY;

  function sweep(now: number): void {
    if (now < nextSweepAt) return;
    let earliest = Number.POSITIVE_INFINITY;
    for (const [key, entry] of entries) {
      const expiry = expiryOf(entry);
      if (expiry <= now) entries.delete(key);
      else earliest = Math.min(earliest, expiry);
    }
    nextSweepAt = earliest;
  }

  return {
    get: (key) => entries.get(key),
    set: (key, entry) => {
      entries.set(key, entry);
      nextSweepAt = Math.min(nextSweepAt, expiryOf(entry));
    },
    delete: (key) => {
      entries.delete(key);
    },
    clear: () => {
      entries.clear();
      nextSweepAt = Number.POSITIVE_INFINITY;
    },
    size: () => entries.size,
    hasRoomForNewKey: (now) => {
      if (entries.size < maxKeys) return true;
      sweep(now);
      return entries.size < maxKeys;
    },
  };
}

export function createRateLimiter(config: RateLimitConfig, clock: () => number = Date.now): RateLimiter {
  validateConfig(config);
  const store = createEntryStore(config.maxKeys ?? DEFAULT_MAX_KEYS);

  function check(key: string): RateLimitDecision {
    const now = clock();
    const entry = store.get(key);
    if (entry === undefined) {
      return store.hasRoomForNewKey(now) ? ALLOWED : { ok: false, retryAfterSeconds: FAIL_CLOSED_RETRY_AFTER_SECONDS };
    }
    return entry.lockedUntil !== null && entry.lockedUntil > now ? blocked(entry.lockedUntil - now) : ALLOWED;
  }

  function hit(key: string): void {
    const now = clock();
    const entry = store.get(key);
    if (entry === undefined && !store.hasRoomForNewKey(now)) return; // gagal-tertutup: check() key ini tetap memblokir
    const next = nextEntry(entry, config, now);
    if (next !== null) store.set(key, next);
  }

  return {
    check,
    hit,
    recordFailure: hit,
    reset: (key: string): void => store.delete(key),
    clear: (): void => store.clear(),
    size: (): number => store.size(),
  };
}
