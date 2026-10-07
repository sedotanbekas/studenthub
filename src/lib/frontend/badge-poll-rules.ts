import type { Role } from "./types";

/**
 * Aturan murni poller badge notifikasi (N1): kapan mengambil unread-count, jeda berikutnya (jitter + backoff),
 * penanganan galat, label badge, dan keputusan setelah penyegaran sesi. Tanpa DOM; diuji dengan node:test.
 */

export const BADGE_POLL_BASE_MS: Readonly<Record<Role, number>> = { SCHOOL_ADMIN: 30_000, SUPER_ADMIN: 30_000, SPONSOR: 30_000, STUDENT: 60_000, REGION_ADMIN: 60_000 };
export const BADGE_BACKOFF_MAX_MS = 300_000;
export const BADGE_JITTER_RATIO = 0.1;
/** visible/focus/online beruntun dalam jeda ini = satu permintaan (hanya setelah percobaan yang berhasil). */
export const BADGE_MIN_GAP_MS = 5_000;
export const BADGE_LABEL_MAX = 99;
/** 409 REFRESH_RACE: tab lain sedang memutar token; tunggu Set-Cookie pemenang sebelum mengulang. */
export const REFRESH_RACE_WAIT_MS = 300;

export type BadgeTrigger = "start" | "timer" | "visible" | "focus" | "online" | "mutation";

export interface BadgePollState {
  readonly failures: number;
  readonly lastAttemptAt: number | null;
  readonly lastOk: boolean;
  readonly inFlight: boolean;
  /** Jadwal polling berikutnya; DIPERTAHANKAN saat tersembunyi (hanya timer OS yang dihapus). */
  readonly nextDueAt: number | null;
  /** Batas keras dari Retry-After (429). */
  readonly notBefore: number | null;
}

export const IDLE_BADGE_STATE: BadgePollState = Object.freeze({ failures: 0, lastAttemptAt: null, lastOk: true, inFlight: false, nextDueAt: null, notBefore: null });

export type BadgeDecision = { readonly action: "fetch" } | { readonly action: "queue" } | { readonly action: "idle" } | { readonly action: "wait"; readonly delayMs: number };

const FETCH: BadgeDecision = { action: "fetch" };
const at = (due: number, now: number): BadgeDecision => (due <= now ? FETCH : { action: "wait", delayMs: due - now });

/**
 * Sedang berjalan: mutasi diantrekan, lainnya diam (selesai -> jadwal). Tersembunyi: hanya mutasi. Retry-After
 * selalu dihormati. start/timer/mutasi -> ambil. visible/focus/online -> ambil bila jadwal sudah lewat dan >= 5 dtk
 * sejak percobaan berhasil; bila belum, TUNGGU sampai jadwal (tidak pernah "lewati" tanpa timer). Setelah gagal,
 * `online` langsung mengambil (jaringan kembali).
 */
export function decideFetch(s: BadgePollState, trigger: BadgeTrigger, now: number, visible: boolean): BadgeDecision {
  if (s.inFlight) return trigger === "mutation" ? { action: "queue" } : { action: "idle" };
  if (!visible && trigger !== "mutation") return { action: "idle" };
  const floor = Math.max(s.notBefore ?? -Infinity, s.lastOk && s.lastAttemptAt !== null ? s.lastAttemptAt + BADGE_MIN_GAP_MS : -Infinity);
  if (trigger === "start" || trigger === "timer" || trigger === "mutation") return s.notBefore !== null ? at(s.notBefore, now) : FETCH;
  if (s.lastAttemptAt === null) return FETCH;
  if (trigger === "online" && !s.lastOk) return at(s.notBefore ?? now, now);
  return at(Math.max(s.nextDueAt ?? now, floor), now);
}

/** max(Retry-After, round(min(MAX, dasar × 2^gagal) × jitter)) — jitter setelah batas agar klien tidak serempak. */
export function nextDelayMs(input: { role: Role; failures: number; random: number; retryAfterMs?: number }): number {
  const backoff = Math.min(BADGE_BACKOFF_MAX_MS, BADGE_POLL_BASE_MS[input.role] * 2 ** Math.min(input.failures, 10));
  const jitter = 1 - BADGE_JITTER_RATIO + 2 * BADGE_JITTER_RATIO * input.random;
  return Math.max(input.retryAfterMs ?? 0, Math.round(backoff * jitter));
}

/** 403 = peran/akun tidak boleh lagi -> berhenti. 401 dibiarkan: sesi yang benar-benar berakhir tiba lewat alur sesi. */
export const classifyPollFailure = (status: number): "retry" | "stop" => (status === 403 ? "stop" : "retry");

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** Retry-After dari body galat (`error.details.retryAfterSeconds`); proxy web tidak meneruskan header-nya. */
export function retryAfterFromBody(body: unknown): number | undefined {
  const details = isRecord(body) && isRecord(body.error) && isRecord(body.error.details) ? body.error.details : null;
  const seconds = details?.retryAfterSeconds;
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

export function parseUnreadTotal(body: unknown): number | null {
  if (!isRecord(body) || body.success !== true || !isRecord(body.data)) return null;
  const total = body.data.total;
  return typeof total === "number" && Number.isInteger(total) && total >= 0 ? total : null;
}

export const badgeLabel = (count: number): string => (count <= 0 ? "" : count > BADGE_LABEL_MAX ? `${BADGE_LABEL_MAX}+` : String(count));

const BADGE_MUTATIONS: ReadonlySet<string> = new Set(["markNotificationRead", "markAllNotificationsRead"]);
export const affectsUnreadBadge = (operationId: string): boolean => BADGE_MUTATIONS.has(operationId);

/** Hasil POST /auth/refresh -> ulangi permintaan asli, tunggu-lalu-ulangi (409 balapan antartab), atau sesi berakhir. */
export function afterRefresh(status: number): "retry" | "wait-retry" | "expire" {
  if (status >= 200 && status < 300) return "retry";
  return status === 409 ? "wait-retry" : "expire";
}
