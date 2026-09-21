import type { ExpoPushMessage, ExpoPushTicket } from "expo-server-sdk";
import { getEnv } from "@/lib/env";
import { EXPO_PUSH_CHUNK } from "../constants";
import { chunk } from "../rules";
import type { PushMessage, PushTicket, PushTransport } from "../types";

/**
 * Transport `expo` (produksi): expo-server-sdk, maks 100 pesan per request, access token dari
 * EXPO_ACCESS_TOKEN bila Enhanced Push Security aktif. SDK dimuat malas (paket ESM, serverExternalPackages).
 * Error request (HTTP != 200 / jaringan) diteruskan apa adanya: `statusCode` dipakai classifyRequestError.
 */
export interface ExpoClientLike {
  sendPushNotificationsAsync(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]>;
}

async function loadDefaultClient(): Promise<ExpoClientLike> {
  const { Expo } = await import("expo-server-sdk");
  const accessToken = getEnv().EXPO_ACCESS_TOKEN;
  return new Expo(accessToken ? { accessToken } : {});
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
