import type { DeviceResult } from "../../rules";
import type { WebPushSend, WebPushTransport } from "../types";

/** Transport Web Push `memory` (test & CI): mencatat kiriman; hasil per kiriman bisa diskenariokan (mis. 410). */
export type WebPushStatusScript = (item: WebPushSend) => DeviceResult | undefined;

export interface MemoryWebPushTransport extends WebPushTransport {
  readonly name: "memory";
  sent(): readonly WebPushSend[];
  setStatusScript(script: WebPushStatusScript | null): void;
  reset(): void;
}

export function createMemoryWebPushTransport(): MemoryWebPushTransport {
  let sent: readonly WebPushSend[] = [];
  let script: WebPushStatusScript | null = null;
  return {
    name: "memory",
    async send(items) {
      sent = [...sent, ...items];
      return items.map((item) => script?.(item) ?? { kind: "ok" });
    },
    sent: () => [...sent],
    setStatusScript(next) {
      script = next;
    },
    reset() {
      sent = [];
      script = null;
    },
  };
}

/** Instans bersama proses (dipilih getWebPushTransport saat PUSH_TRANSPORT=memory dan kunci VAPID ada). */
export const memoryWebPushTransport: MemoryWebPushTransport = createMemoryWebPushTransport();
