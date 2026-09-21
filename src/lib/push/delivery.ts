import { prisma } from "@/lib/db";
import { log } from "@/lib/log";
import { EXPO_PUSH_CHUNK } from "./constants";
import { buildPushMessage, chunk, classifyRequestError, classifyTicket, type DeviceResult, type PushSource } from "./rules";
import type { PushMessage, PushTransport } from "./types";

/** Perangkat penerima, pengiriman per chunk, dan pembersihan token DeviceNotRegistered. */

export interface Device {
  readonly sessionId: string;
  readonly token: string;
}

export interface Delivery extends Device {
  readonly notificationId: string;
  readonly message: PushMessage;
}

/** Sesi hidup (belum dicabut, belum kedaluwarsa) yang punya token Expo, dikelompokkan per user. */
export async function loadDevices(userIds: readonly string[], now: Date): Promise<ReadonlyMap<string, readonly Device[]>> {
  if (userIds.length === 0) return new Map();
  const sessions = await prisma.authSession.findMany({
    where: { userId: { in: [...userIds] }, revokedAt: null, expiresAt: { gt: now }, expoPushToken: { not: null } },
    select: { id: true, userId: true, expoPushToken: true },
  });
  const byUser = new Map<string, Device[]>();
  for (const s of sessions) {
    if (!s.expoPushToken) continue;
    byUser.set(s.userId, [...(byUser.get(s.userId) ?? []), { sessionId: s.id, token: s.expoPushToken }]);
  }
  return byUser;
}

export function buildDeliveries(rows: readonly (PushSource & { readonly userId: string })[], devices: ReadonlyMap<string, readonly Device[]>): Delivery[] {
  return rows.flatMap((row) =>
    (devices.get(row.userId) ?? []).map((device) => ({ ...device, notificationId: row.id, message: buildPushMessage(row, device.token) })),
  );
}

function logTicketAlerts(results: readonly DeviceResult[]): void {
  if (results.some((r) => r.kind === "fail" && r.error === "InvalidCredentials")) {
    log.error("push.invalid_credentials", { hint: "Periksa EXPO_ACCESS_TOKEN / kredensial FCM-APNs proyek Expo." });
  }
}

async function sendChunk(part: readonly Delivery[], transport: PushTransport): Promise<DeviceResult[]> {
  try {
    const tickets = await transport.send(part.map((d) => d.message));
    const results = part.map((_, i) => classifyTicket(tickets[i]));
    logTicketAlerts(results);
    return results;
  } catch (error) {
    const result = classifyRequestError(error);
    log.warn("push.request_failed", { transport: transport.name, messages: part.length, result: result.kind, error: result.error });
    return part.map(() => result);
  }
}

/** Kirim berurutan per chunk (<= 100); hasil sejajar dengan `deliveries`. */
export async function sendDeliveries(deliveries: readonly Delivery[], transport: PushTransport): Promise<DeviceResult[]> {
  const results: DeviceResult[] = [];
  for (const part of chunk(deliveries, EXPO_PUSH_CHUNK)) results.push(...(await sendChunk(part, transport)));
  return results;
}

/** Token yang ditolak Expo (DeviceNotRegistered) dilepas dari sesinya — hanya bila masih token yang sama. */
export async function clearUnregisteredTokens(deliveries: readonly Delivery[], results: readonly DeviceResult[]): Promise<number> {
  const stale = deliveries.filter((_, i) => results[i]?.kind === "unregistered");
  let cleared = 0;
  for (const d of stale) {
    const { count } = await prisma.authSession.updateMany({ where: { id: d.sessionId, expoPushToken: d.token }, data: { expoPushToken: null } });
    cleared += count;
  }
  return cleared;
}
