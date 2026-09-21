import { getEnv } from "@/lib/env";
import { createExpoTransport } from "./transports/expo";
import { createLogTransport } from "./transports/log";
import { memoryPushTransport } from "./transports/memory";
import type { PushTransport, PushTransportName } from "./types";

/** Pemilihan transport push dari PUSH_TRANSPORT (log | memory | expo); satu instans per proses. */
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
