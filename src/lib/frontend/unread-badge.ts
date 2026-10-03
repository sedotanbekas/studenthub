import { apiFetch } from "./api";
import {
  IDLE_BADGE_STATE,
  classifyPollFailure,
  decideFetch,
  nextDelayMs,
  parseUnreadTotal,
  retryAfterFromBody,
  type BadgePollState,
  type BadgeTrigger,
} from "./badge-poll-rules";
import type { Role } from "./types";

/**
 * Poller badge notifikasi bersama (N1): SATU per tab untuk lonceng topbar & badge sidebar. Mengambil
 * GET /notifications/unread-count saat mulai, kembali ke halaman (visible/focus/online), sesudah "tandai dibaca",
 * dan berkala selama terlihat (staf 30 dtk, siswa 60 dtk, jitter ±10%, backoff s.d. 5 menit). Berhenti saat keluar
 * atau ganti akun; hasil akun lama dibuang (generation). Tanpa navigator.setAppBadge — badge ikon milik N3.
 */

export interface BadgeSession { readonly userId: string; readonly role: Role }
export type BadgeSignal = "visible" | "hidden" | "focus" | "online";
/** status 0 = galat jaringan; -1 = dibatalkan. */
export interface FetchResult { readonly status: number; readonly body: unknown }

export interface BadgeDeps {
  fetchUnread(signal: AbortSignal): Promise<FetchResult>;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  now(): number;
  random(): number;
  isVisible(): boolean;
  listen(on: (signal: BadgeSignal) => void): () => void;
}

const NETWORK_FAILURE: FetchResult = { status: 0, body: null };

export class UnreadBadgePoller {
  private session: BadgeSession | null = null;
  private state: BadgePollState = IDLE_BADGE_STATE;
  private count = 0;
  private generation = 0;
  private timer: unknown = null;
  private controller: AbortController | null = null;
  private unlisten: (() => void) | null = null;
  private queued = false;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: BadgeDeps) {}

  /** Sesi sama & sedang berjalan -> tanpa efek. Sesi lain -> stop dulu (angka 0), lalu ambil segera. */
  start(session: BadgeSession): void {
    if (this.session?.userId === session.userId && this.session.role === session.role) return;
    this.stop();
    this.session = session;
    this.unlisten = this.deps.listen((signal) => this.onSignal(signal));
    this.run("start");
  }

  /** Batalkan permintaan, hapus timer & listener, reset seluruh keadaan, angka 0. */
  stop(): void {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    this.clearTimer();
    this.unlisten?.();
    this.unlisten = null;
    this.session = null;
    this.state = IDLE_BADGE_STATE;
    this.queued = false;
    this.setCount(0);
  }

  /** Sesudah mutasi milik sendiri (tandai dibaca): ambil segera (diantrekan bila sedang mengambil). */
  refresh(): void {
    this.run("mutation");
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  readonly getSnapshot = (): number => this.count;

  private onSignal(signal: BadgeSignal): void {
    if (signal === "hidden") this.clearTimer();
    else this.run(signal);
  }

  private run(trigger: BadgeTrigger): void {
    const session = this.session;
    if (!session) return;
    const decision = decideFetch(this.state, trigger, this.deps.now(), this.deps.isVisible());
    if (decision.action === "queue") this.queued = true;
    else if (decision.action === "wait") this.arm(decision.delayMs);
    else if (decision.action === "fetch") void this.fetch(session);
  }

  private async fetch(session: BadgeSession): Promise<void> {
    const generation = this.generation;
    this.clearTimer();
    const controller = new AbortController();
    this.controller = controller;
    this.state = { ...this.state, inFlight: true, lastAttemptAt: this.deps.now() };
    const result = await this.deps.fetchUnread(controller.signal).catch(() => NETWORK_FAILURE);
    if (generation !== this.generation) return;
    this.controller = null;
    this.settle(session, result);
    if (this.queued && generation === this.generation) {
      this.queued = false;
      this.run("mutation");
    }
  }

  private settle(session: BadgeSession, result: FetchResult): void {
    const now = this.deps.now();
    const total = result.status >= 200 && result.status < 300 ? parseUnreadTotal(result.body) : null;
    if (total !== null) {
      const due = now + nextDelayMs({ role: session.role, failures: 0, random: this.deps.random() });
      this.state = { failures: 0, lastAttemptAt: this.state.lastAttemptAt, lastOk: true, inFlight: false, nextDueAt: due, notBefore: null };
      this.setCount(total);
    } else {
      if (classifyPollFailure(result.status) === "stop") return this.stop();
      const failures = this.state.failures + 1;
      const retryAfterMs = retryAfterFromBody(result.body);
      const due = now + nextDelayMs({ role: session.role, failures, random: this.deps.random(), retryAfterMs });
      this.state = { failures, lastAttemptAt: this.state.lastAttemptAt, lastOk: false, inFlight: false, nextDueAt: due, notBefore: retryAfterMs ? now + retryAfterMs : null };
    }
    if (this.deps.isVisible() && this.state.nextDueAt !== null) this.arm(Math.max(0, this.state.nextDueAt - now));
  }

  private arm(ms: number): void {
    this.clearTimer();
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      this.run("timer");
    }, ms);
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    this.deps.clearTimer(this.timer);
    this.timer = null;
  }

  private setCount(next: number): void {
    if (next === this.count) return;
    this.count = next;
    for (const listener of this.listeners) listener();
  }
}

/** Dependensi browser; semua akses DOM ada di dalam fungsi (aman diimpor saat SSR). */
export function browserBadgeDeps(): BadgeDeps {
  return {
    async fetchUnread(signal) {
      try {
        // background: sesi yang berakhir tidak menendang pengguna dari formulir; aksi berikutnya yang menanganinya.
        const response = await apiFetch("/notifications/unread-count", { signal }, { background: true });
        return { status: response.status, body: await response.json().catch(() => null) };
      } catch (error) {
        return error instanceof DOMException && error.name === "AbortError" ? { status: -1, body: null } : NETWORK_FAILURE;
      }
    },
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (handle) => window.clearTimeout(handle as number),
    now: () => Date.now(),
    random: () => Math.random(),
    isVisible: () => typeof document === "undefined" || document.visibilityState === "visible",
    listen(on) {
      const visibility = () => on(document.visibilityState === "visible" ? "visible" : "hidden");
      const focus = () => on("focus");
      const online = () => on("online");
      document.addEventListener("visibilitychange", visibility);
      window.addEventListener("focus", focus);
      window.addEventListener("online", online);
      return () => {
        document.removeEventListener("visibilitychange", visibility);
        window.removeEventListener("focus", focus);
        window.removeEventListener("online", online);
      };
    },
  };
}

const GLOBAL_KEY = "__studenthubUnreadBadge";
const store = globalThis as typeof globalThis & { [GLOBAL_KEY]?: UnreadBadgePoller };

/** Satu instans per tab; disimpan di globalThis agar HMR dev tidak membuat poller ganda. */
export const unreadBadge: UnreadBadgePoller = (store[GLOBAL_KEY] ??= new UnreadBadgePoller(browserBadgeDeps()));
