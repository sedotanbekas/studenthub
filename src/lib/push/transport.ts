import { getEnv } from "@/lib/env";
import { createExpoTransport } from "./transports/expo";
import { createLogTransport } from "./transports/log";
import { memoryPushTransport } from "./transports/memory";
import type { PushTransport, PushTransportName } from "./types";
import { webPushSettingsOf, type WebPushSettings } from "./web/rules";
import { createWebPushTransport } from "./web/transports/webpush";
import { memoryWebPushTransport } from "./web/transports/web-memory";
import type { WebPushTransport } from "./web/types";

/** Pemilihan transport push dari PUSH_TRANSPORT (log | memory | expo) + Web Push (N3); satu instans per proses. */
const logTransport = createLogTransport();
const expoTransport = createExpoTransport();

export function transportFor(name: PushTransportName): PushTransport {
  if (name === "expo") return expoTransport;
  if (name === "memory") return memoryPushTransport;
  return logTransport;
}

export function getPushTransport(): PushTransport {
  return transportFor(getEnv().PUSH_TRANSPORT);
}

/** Mode Web Push dari env (N3): tanpa kunci VAPID = mati. */
export const webPushSettings = (): WebPushSettings => webPushSettingsOf(getEnv());

let vapid: { readonly key: string; readonly transport: WebPushTransport } | undefined;

/** Transport Web Push; null = mati (tanpa kunci / subjek tidak sah). PUSH_TRANSPORT=memory -> transport memori. */
export function getWebPushTransport(): WebPushTransport | null {
  const settings = webPushSettings();
  if (settings.mode === "off") return null;
  if (settings.mode === "memory") return memoryWebPushTransport;
  const key = `${settings.publicKey}|${settings.subject}`;
  if (vapid?.key !== key) vapid = { key, transport: createWebPushTransport(settings) };
  return vapid.transport;
}
