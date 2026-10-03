import type { PushSubscription, RequestOptions } from "web-push";
import { log } from "@/lib/log";
import { PUSH_ERROR } from "../../constants";
import type { DeviceResult } from "../../rules";
import { classifyWebPushError, WEB_PUSH_TIMEOUT_CODE } from "../rules";
import type { WebPushSend, WebPushTransport } from "../types";

/**
 * Transport Web Push VAPID (N3): pustaka web-push dimuat malas lewat ekspor `default` (paket CommonJS: di ESM
 * `sendNotification` hanya ada di default), maks 20 kiriman bersamaan, batas waktu KERAS per kiriman (opsi
 * `timeout` web-push hanya batas diam soket). Galat diklasifikasikan per kiriman; tidak pernah melempar.
 * Endpoint tidak pernah dilog — hanya host-nya.
 *
 * Invarian lease: dispatcher memanggil transport per potongan 100 perangkat; ⌈100/20⌉ gelombang × 8 detik = 40 detik
 * per potongan, dikirim paralel dengan Expo, dan potongan baru tidak dimulai setelah anggaran putaran (<= 50 detik
 * pada jalur tick) habis -> selalu di bawah lease klaim 120 detik.
 */
export type WebPushSender = (subscription: PushSubscription, payload: string, options: RequestOptions) => Promise<unknown>;

export const WEB_PUSH_CONCURRENCY = 20;
export const WEB_PUSH_SEND_TIMEOUT_MS = 8_000;
const SOCKET_IDLE_TIMEOUT_MS = 5_000;

export interface VapidCredentials {
  readonly publicKey: string;
  readonly privateKey: string;
  readonly subject: string;
}

export interface WebPushTransportDeps {
  readonly loadSender?: () => Promise<WebPushSender>;
  readonly timeoutMs?: number;
}

export async function loadWebPushSender(): Promise<WebPushSender> {
  const webpush = (await import("web-push")).default;
  return (subscription, payload, options) => webpush.sendNotification(subscription, payload, options);
}

/** Jalankan `fn` untuk tiap item dengan paling banyak `limit` sekaligus; hasil sejajar dengan urutan masukan. */
export async function mapWithLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error("Web Push melewati batas waktu"), { code: WEB_PUSH_TIMEOUT_CODE })), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

const hostOf = (endpoint: string): string => {
  try {
    return new URL(endpoint).host;
  } catch {
    return "?";
  }
};

async function sendOne(sender: WebPushSender, item: WebPushSend, credentials: VapidCredentials, timeoutMs: number): Promise<DeviceResult> {
  const options: RequestOptions = {
    TTL: item.ttlSeconds,
    urgency: "high",
    timeout: SOCKET_IDLE_TIMEOUT_MS,
    contentEncoding: "aes128gcm",
    vapidDetails: { subject: credentials.subject, publicKey: credentials.publicKey, privateKey: credentials.privateKey },
  };
  try {
    await withDeadline(sender({ endpoint: item.target.endpoint, keys: { ...item.target.keys } }, JSON.stringify(item.payload), options), timeoutMs);
    return { kind: "ok" };
  } catch (error) {
    const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
    if (statusCode === 401 || statusCode === 403) log.warn("push.webpush_credentials", { host: hostOf(item.target.endpoint), statusCode });
    return classifyWebPushError(error);
  }
}

export function createWebPushTransport(credentials: VapidCredentials, deps: WebPushTransportDeps = {}): WebPushTransport {
  let sender: Promise<WebPushSender> | undefined;
  const timeoutMs = deps.timeoutMs ?? WEB_PUSH_SEND_TIMEOUT_MS;
  return {
    name: "vapid",
    async send(items) {
      let ready: WebPushSender;
      try {
        ready = await (sender ??= (deps.loadSender ?? loadWebPushSender)());
      } catch (error) {
        sender = undefined;
        log.error("push.webpush_unavailable", { error: error instanceof Error ? error.message : String(error) });
        return items.map(() => ({ kind: "retry", error: PUSH_ERROR.NETWORK_ERROR }) as const);
      }
      return mapWithLimit(items, WEB_PUSH_CONCURRENCY, (item) => sendOne(ready, item, credentials, timeoutMs));
    },
  };
}
