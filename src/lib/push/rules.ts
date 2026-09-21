import { previewText } from "@/lib/notifications/rules";
import {
  DEFAULT_PUSH_SCREEN,
  PUSH_BACKOFF_MINUTES,
  PUSH_BODY_MAX,
  PUSH_ERROR,
  PUSH_ERROR_MAX,
  PUSH_MAX_AGE_MINUTES,
  PUSH_MAX_ATTEMPTS,
  PUSH_TITLE_MAX,
} from "./constants";
import type { PushMessage, PushTicket } from "./types";

/** Aturan murni dispatcher push: pembentukan pesan, klasifikasi tiket/error, backoff, hasil agregat. */

export type DeviceResult =
  | { readonly kind: "ok" }
  | { readonly kind: "unregistered" }
  | { readonly kind: "retry"; readonly error: string }
  | { readonly kind: "fail"; readonly error: string };

export type PushOutcome =
  | { readonly status: "SENT" }
  | { readonly status: "PENDING"; readonly nextAttemptAt: Date; readonly error: string }
  | { readonly status: "FAILED"; readonly error: string }
  | { readonly status: "SKIPPED"; readonly error: string };

const MINUTE_MS = 60_000;
const SAFE_CODE = /^[A-Za-z0-9_:.-]+$/;
const RETRYABLE_TICKET_ERRORS: ReadonlySet<string> = new Set(["MessageRateExceeded"]);

/** Kode error aman disimpan/dilog (tanpa spasi → tidak pernah memuat pesan mentah berisi token). */
export function sanitizeErrorCode(code: string): string {
  return SAFE_CODE.test(code) ? code.slice(0, PUSH_ERROR_MAX) : PUSH_ERROR.UNKNOWN;
}

/** Deep link dari Notification.data {screen, id}; bawaan = detail notifikasi itu sendiri. */
export function pushLinkOf(data: unknown, notificationId: string): { screen: string; id: string } {
  if (typeof data === "object" && data !== null && !Array.isArray(data)) {
    const { screen, id } = data as { screen?: unknown; id?: unknown };
    if (typeof screen === "string" && typeof id === "string") return { screen, id };
  }
  return { screen: DEFAULT_PUSH_SCREEN, id: notificationId };
}

export interface PushSource {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly data: unknown;
}

export function buildPushMessage(row: PushSource, token: string): PushMessage {
  return {
    to: token,
    title: previewText(row.title, PUSH_TITLE_MAX),
    body: previewText(row.body, PUSH_BODY_MAX),
    data: { notificationId: row.id, ...pushLinkOf(row.data, row.id) },
    sound: "default",
    priority: "high",
    channelId: "default",
  };
}

/** Tiket Expo -> hasil per perangkat. Tiket hilang (jumlah tak cocok) diperlakukan sementara. */
export function classifyTicket(ticket: PushTicket | undefined): DeviceResult {
  if (!ticket) return { kind: "retry", error: PUSH_ERROR.MISSING_TICKET };
  if (ticket.status === "ok") return { kind: "ok" };
  const code = ticket.details?.error;
  if (code === PUSH_ERROR.DEVICE_NOT_REGISTERED) return { kind: "unregistered" };
  if (code && RETRYABLE_TICKET_ERRORS.has(code)) return { kind: "retry", error: code };
  return { kind: "fail", error: code ? sanitizeErrorCode(code) : PUSH_ERROR.UNKNOWN };
}

/** Error level request: 429 / 5xx / jaringan (tanpa statusCode) -> retry; 4xx lain -> fail. */
export function classifyRequestError(error: unknown): Extract<DeviceResult, { kind: "retry" | "fail" }> {
  const { statusCode, code } = (typeof error === "object" && error !== null ? error : {}) as { statusCode?: unknown; code?: unknown };
  if (statusCode === 429 || code === PUSH_ERROR.TOO_MANY_REQUESTS) return { kind: "retry", error: PUSH_ERROR.TOO_MANY_REQUESTS };
  if (typeof statusCode !== "number") return { kind: "retry", error: PUSH_ERROR.NETWORK_ERROR };
  if (statusCode >= 500) return { kind: "retry", error: `HTTP_${statusCode}` };
  const suffix = typeof code === "string" && SAFE_CODE.test(code) ? `:${code}` : "";
  return { kind: "fail", error: sanitizeErrorCode(`HTTP_${statusCode}${suffix}`) };
}

/** Jeda sebelum percobaan berikutnya; `attempts` = jumlah percobaan sebelum yang barusan gagal. */
export function retryDelayMinutes(attempts: number): number {
  const steps: readonly number[] = PUSH_BACKOFF_MINUTES;
  const last = steps.at(-1) ?? 1;
  return steps[Math.max(attempts, 0)] ?? last;
}

/**
 * Hasil satu notifikasi dari seluruh perangkat penerima: ada yang ok -> SENT; ada yang sementara dan
 * percobaan (attempts + 1) < 4 -> PENDING + backoff; selain itu FAILED (error permanen didahulukan).
 */
export function aggregateOutcome(results: readonly DeviceResult[], attempts: number, now: Date): PushOutcome {
  if (results.length === 0) return { status: "SKIPPED", error: PUSH_ERROR.NO_DEVICE };
  if (results.some((r) => r.kind === "ok")) return { status: "SENT" };
  const retry = results.find((r) => r.kind === "retry");
  if (retry && attempts + 1 < PUSH_MAX_ATTEMPTS) {
    return { status: "PENDING", nextAttemptAt: new Date(now.getTime() + retryDelayMinutes(attempts) * MINUTE_MS), error: retry.error };
  }
  const failure = results.find((r) => r.kind === "fail") ?? retry;
  return { status: "FAILED", error: failure ? failure.error : PUSH_ERROR.DEVICE_NOT_REGISTERED };
}

export function isExpired(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() > PUSH_MAX_AGE_MINUTES * MINUTE_MS;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error("Ukuran chunk harus bilangan bulat >= 1");
  return Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
}
