import { IMPRESSION_DEDUPE_WINDOW_MS, IMPRESSION_STORE_MAX_ENTRIES } from "./constants";

/**
 * Penyimpan impresi in-memory (proses PM2 fork tunggal, seperti limiter). Per (siswa, iklan) mencatat
 * kapan impresi terakhir DIHITUNG (dedupe 30 menit) dan kapan terakhir TERLIHAT (penilaian klik SUSPECT).
 * Kapasitas dibatasi: entri tertua (urutan sisip Map) dibuang. Setelah restart, klik dalam 30 menit
 * pertama bisa dinilai SUSPECT (tidak ditagih) — aman untuk sponsor.
 */
export type ImpressionOutcome = "ACCEPTED" | "DUPLICATE";

export interface ImpressionStore {
  record(userId: string, adId: string, now: Date): ImpressionOutcome;
  seenWithin(userId: string, adId: string, now: Date, windowMs: number): boolean;
  size(): number;
  clear(): void;
}

interface Entry {
  readonly countedAt: number;
  readonly seenAt: number;
}

export interface ImpressionStoreOptions {
  readonly windowMs: number;
  readonly maxEntries: number;
}

export function createImpressionStore(options: ImpressionStoreOptions): ImpressionStore {
  const entries = new Map<string, Entry>();
  const keyOf = (userId: string, adId: string): string => `${userId}:${adId}`;
  const put = (key: string, entry: Entry): void => {
    entries.delete(key);
    entries.set(key, entry);
    while (entries.size > options.maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  };
  return {
    record(userId, adId, now) {
      const key = keyOf(userId, adId);
      const t = now.getTime();
      const current = entries.get(key);
      const counted = !current || t - current.countedAt >= options.windowMs;
      put(key, { countedAt: counted ? t : (current?.countedAt ?? t), seenAt: Math.max(t, current?.seenAt ?? t) });
      return counted ? "ACCEPTED" : "DUPLICATE";
    },
    seenWithin(userId, adId, now, windowMs) {
      const entry = entries.get(keyOf(userId, adId));
      if (!entry) return false;
      const age = now.getTime() - entry.seenAt;
      return age >= 0 && age <= windowMs;
    },
    size: () => entries.size,
    clear: () => entries.clear(),
  };
}

const STORE_KEY = "__studenthubImpressionStore";
const globalStore = globalThis as typeof globalThis & { [STORE_KEY]?: ImpressionStore };

/** Singleton per proses (disimpan di globalThis agar hot-reload dev tidak mereset). */
export function getImpressionStore(): ImpressionStore {
  globalStore[STORE_KEY] ??= createImpressionStore({ windowMs: IMPRESSION_DEDUPE_WINDOW_MS, maxEntries: IMPRESSION_STORE_MAX_ENTRIES });
  return globalStore[STORE_KEY];
}
