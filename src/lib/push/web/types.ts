import type { DeviceResult } from "../rules";
import type { WebPushPayload } from "./rules";

/** Tipe transport Web Push (N3). Sengaja tidak bergantung pada pustaka web-push. */

export interface WebPushTarget {
  readonly endpoint: string;
  readonly keys: { readonly p256dh: string; readonly auth: string };
}

export interface WebPushSend {
  readonly target: WebPushTarget;
  readonly payload: WebPushPayload;
  readonly ttlSeconds: number;
}

export interface WebPushTransport {
  readonly name: "vapid" | "memory";
  /** Hasil ke-n milik kiriman ke-n. TIDAK pernah melempar: galat per kiriman sudah diklasifikasikan. */
  send(items: readonly WebPushSend[]): Promise<readonly DeviceResult[]>;
}
