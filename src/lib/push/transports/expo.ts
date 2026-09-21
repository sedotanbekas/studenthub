import type { ExpoPushMessage, ExpoPushTicket } from "expo-server-sdk";
import { getEnv } from "@/lib/env";
import { EXPO_HTTP_TIMEOUTS, EXPO_PUSH_CHUNK } from "../constants";
import { chunk } from "../rules";
import type { PushMessage, PushTicket, PushTransport } from "../types";

/**
 * Transport `expo` (produksi): expo-server-sdk, maks 100 pesan per request, access token dari
 * EXPO_ACCESS_TOKEN bila Enhanced Push Security aktif, batas waktu per request (EXPO_HTTP_TIMEOUTS). SDK & undici
 * dimuat malas (paket ESM, serverExternalPackages).
 * Error request (HTTP != 200 / jaringan) diteruskan apa adanya: `statusCode` dipakai classifyRequestError.
 */
export interface ExpoClientLike {
  sendPushNotificationsAsync(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]>;
}

export interface ExpoHttpTimeouts {
  readonly connectMs: number;
  readonly headersMs: number;
  readonly bodyMs: number;
}

/**
 * Klien Expo dengan batas waktu per request lewat undici Agent (dispatcher fetch SDK). Tanpa ini SDK memakai
 * Agent global undici (header & body 300 detik) sehingga Expo yang lambat menahan dispatcher. Timeout
 * dilempar sebagai error jaringan (tanpa statusCode) -> classifyRequestError: retry.
 */
export async function createExpoClient(options: { accessToken?: string; timeouts?: ExpoHttpTimeouts } = {}): Promise<ExpoClientLike> {
  const [{ Expo }, { Agent }] = await Promise.all([import("expo-server-sdk"), import("undici")]);
  const timeouts = options.timeouts ?? EXPO_HTTP_TIMEOUTS;
  const httpAgent = new Agent({ connect: { timeout: timeouts.connectMs }, headersTimeout: timeouts.headersMs, bodyTimeout: timeouts.bodyMs });
  return new Expo({ ...(options.accessToken ? { accessToken: options.accessToken } : {}), httpAgent });
}

function loadDefaultClient(): Promise<ExpoClientLike> {
  return createExpoClient({ accessToken: getEnv().EXPO_ACCESS_TOKEN });
}

export function toExpoMessage(message: PushMessage): ExpoPushMessage {
  return {
    to: message.to,
    title: message.title,
    body: message.body,
    data: { ...message.data },
    sound: message.sound,
    priority: message.priority,
    channelId: message.channelId,
  };
}

export function fromExpoTicket(ticket: ExpoPushTicket): PushTicket {
  if (ticket.status === "ok") return { status: "ok", id: ticket.id };
  return { status: "error", message: ticket.message, details: { error: ticket.details?.error } };
}

export function createExpoTransport(loadClient: () => Promise<ExpoClientLike> = loadDefaultClient): PushTransport {
  let client: Promise<ExpoClientLike> | null = null;
  const getClient = (): Promise<ExpoClientLike> => {
    client ??= loadClient().catch((error: unknown) => {
      client = null;
      throw error;
    });
    return client;
  };
  return {
    name: "expo",
    async send(messages) {
      const expo = await getClient();
      const tickets: PushTicket[] = [];
      for (const part of chunk(messages, EXPO_PUSH_CHUNK)) {
        const result = await expo.sendPushNotificationsAsync(part.map(toExpoMessage));
        tickets.push(...result.map(fromExpoTicket));
      }
      return tickets;
    },
  };
}
