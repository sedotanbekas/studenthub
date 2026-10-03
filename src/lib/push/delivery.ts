import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { log } from "@/lib/log";
import { EXPO_PUSH_CHUNK } from "./constants";
import { buildPushMessage, chunk, classifyRequestError, classifyTicket, type DeviceResult, type PushSource } from "./rules";
import { getWebPushTransport } from "./transport";
import type { PushMessage, PushTransport } from "./types";
import { buildWebPushPayload, webPushTtlSeconds } from "./web/rules";
import type { WebPushSend, WebPushTarget, WebPushTransport } from "./web/types";

/**
 * Perangkat penerima (sesi bertoken Expo + langganan Web Push sesi hidup, N3), pengiriman per potongan 100 (Expo &
 * web paralel, hasil digabung per indeks), dan pembersihan perangkat yang ditolak (DeviceNotRegistered / 404-410).
 */

export type Device =
  | { readonly kind: "expo"; readonly sessionId: string; readonly token: string }
  | { readonly kind: "web"; readonly subscriptionId: string; readonly endpointHash: string; readonly target: WebPushTarget; readonly role: UserRole };

export type Delivery =
  | { readonly kind: "expo"; readonly notificationId: string; readonly sessionId: string; readonly token: string; readonly message: PushMessage }
  | { readonly kind: "web"; readonly notificationId: string; readonly subscriptionId: string; readonly endpointHash: string; readonly send: WebPushSend };

export interface DeliveryTransports {
  readonly expo: PushTransport;
  readonly web: WebPushTransport | null;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  map.set(key, [...(map.get(key) ?? []), value]);
}

/** Sesi hidup (belum dicabut, belum kedaluwarsa) yang punya token Expo / langganan Web Push, per user. */
export async function loadDevices(userIds: readonly string[], now: Date, opts: { readonly web: boolean }): Promise<ReadonlyMap<string, readonly Device[]>> {
  if (userIds.length === 0) return new Map();
  const live = { revokedAt: null, expiresAt: { gt: now } };
  const [sessions, subscriptions] = await Promise.all([
    prisma.authSession.findMany({ where: { userId: { in: [...userIds] }, ...live, expoPushToken: { not: null } }, select: { id: true, userId: true, expoPushToken: true } }),
    opts.web
      ? prisma.webPushSubscription.findMany({
          where: { userId: { in: [...userIds] }, session: live },
          select: { id: true, userId: true, endpointHash: true, endpoint: true, p256dh: true, auth: true, user: { select: { role: true } } },
        })
      : Promise.resolve([]),
  ]);
  const byUser = new Map<string, Device[]>();
  for (const s of sessions) if (s.expoPushToken) push(byUser, s.userId, { kind: "expo", sessionId: s.id, token: s.expoPushToken });
  for (const w of subscriptions) {
    push(byUser, w.userId, { kind: "web", subscriptionId: w.id, endpointHash: w.endpointHash, target: { endpoint: w.endpoint, keys: { p256dh: w.p256dh, auth: w.auth } }, role: w.user.role });
  }
  return byUser;
}

/** Perangkat yang benar-benar bisa dijangkau dengan transport aktif (dipakai juga N5 untuk menghitung siswa). */
export function loadReachableDevices(userIds: readonly string[], now: Date): Promise<ReadonlyMap<string, readonly Device[]>> {
  return loadDevices(userIds, now, { web: getWebPushTransport() !== null });
}

/** Jumlah belum dibaca per user (badge ikon aplikasi), hanya untuk user yang punya perangkat web. */
export async function unreadCountsFor(userIds: readonly string[]): Promise<ReadonlyMap<string, number>> {
  if (userIds.length === 0) return new Map();
  const groups = await prisma.notification.groupBy({ by: ["userId"], where: { userId: { in: [...userIds] }, readAt: null }, _count: { _all: true } });
  return new Map(groups.map((g) => [g.userId, g._count._all]));
}

export type DeliverySource = PushSource & { readonly userId: string; readonly createdAt: Date };

export function buildDeliveries(rows: readonly DeliverySource[], devices: ReadonlyMap<string, readonly Device[]>, now: Date, unread: ReadonlyMap<string, number> = new Map()): Delivery[] {
  return rows.flatMap((row) =>
    (devices.get(row.userId) ?? []).map((device): Delivery => {
      if (device.kind === "expo") return { kind: "expo", notificationId: row.id, sessionId: device.sessionId, token: device.token, message: buildPushMessage(row, device.token) };
      const payload = buildWebPushPayload(row, device.role, unread.get(row.userId) ?? null);
      return { kind: "web", notificationId: row.id, subscriptionId: device.subscriptionId, endpointHash: device.endpointHash, send: { target: device.target, payload, ttlSeconds: webPushTtlSeconds(row.createdAt, now) } };
    }),
  );
}

function logTicketAlerts(results: readonly DeviceResult[]): void {
  if (results.some((r) => r.kind === "fail" && r.error === "InvalidCredentials")) {
    log.error("push.invalid_credentials", { hint: "Periksa EXPO_ACCESS_TOKEN / kredensial FCM-APNs proyek Expo." });
  }
}

async function sendExpo(messages: readonly PushMessage[], transport: PushTransport): Promise<DeviceResult[]> {
  try {
    const tickets = await transport.send(messages);
    const results = messages.map((_, i) => classifyTicket(tickets[i]));
    logTicketAlerts(results);
    return results;
  } catch (error) {
    const result = classifyRequestError(error);
    log.warn("push.request_failed", { transport: transport.name, messages: messages.length, result: result.kind, error: result.error });
    return messages.map(() => result);
  }
}

async function sendWeb(items: readonly WebPushSend[], transport: WebPushTransport | null): Promise<readonly DeviceResult[]> {
  if (!transport) return items.map(() => ({ kind: "fail", error: "WEB_PUSH_OFF" }) as const);
  return transport.send(items);
}

/** Satu potongan: Expo & web dikirim bersamaan, hasil dikembalikan sejajar urutan `part`. */
async function sendPart(part: readonly Delivery[], transports: DeliveryTransports): Promise<DeviceResult[]> {
  const expo = part.flatMap((d, i) => (d.kind === "expo" ? [{ i, message: d.message }] : []));
  const web = part.flatMap((d, i) => (d.kind === "web" ? [{ i, send: d.send }] : []));
  const [expoResults, webResults] = await Promise.all([
    expo.length > 0 ? sendExpo(expo.map((e) => e.message), transports.expo) : Promise.resolve([]),
    web.length > 0 ? sendWeb(web.map((w) => w.send), transports.web) : Promise.resolve([]),
  ]);
  const results = new Array<DeviceResult>(part.length);
  expo.forEach((e, k) => { results[e.i] = expoResults[k] ?? { kind: "retry", error: "MISSING_TICKET" }; });
  web.forEach((w, k) => { results[w.i] = webResults[k] ?? { kind: "retry", error: "MISSING_TICKET" }; });
  return results;
}

/**
 * Kirim berurutan per potongan (<= 100) selama `deadline` (epoch ms) belum lewat; hasil sejajar dengan prefiks
 * `deliveries` yang sempat dikirim (results.length <= deliveries.length).
 */
export async function sendDeliveries(deliveries: readonly Delivery[], transports: DeliveryTransports, deadline = Number.POSITIVE_INFINITY): Promise<DeviceResult[]> {
  const results: DeviceResult[] = [];
  for (const part of chunk(deliveries, EXPO_PUSH_CHUNK)) {
    if (Date.now() >= deadline) break;
    results.push(...(await sendPart(part, transports)));
  }
  return results;
}

/**
 * Perangkat yang ditolak dilepas: token Expo (DeviceNotRegistered) dari sesinya bila masih token yang sama; langganan
 * web (404/410) dihapus bila endpoint-nya masih sama. Langganan web yang berhasil diperbarui `lastUsedAt` (satu query).
 */
export async function clearUnregisteredTokens(deliveries: readonly Delivery[], results: readonly DeviceResult[], now: Date = new Date()): Promise<number> {
  let cleared = 0;
  for (const [i, d] of deliveries.entries()) {
    if (results[i]?.kind !== "unregistered") continue;
    if (d.kind === "expo") cleared += (await prisma.authSession.updateMany({ where: { id: d.sessionId, expoPushToken: d.token }, data: { expoPushToken: null } })).count;
    else cleared += (await prisma.webPushSubscription.deleteMany({ where: { id: d.subscriptionId, endpointHash: d.endpointHash } })).count;
  }
  const okWeb = deliveries.flatMap((d, i) => (d.kind === "web" && results[i]?.kind === "ok" ? [d.subscriptionId] : []));
  if (okWeb.length > 0) await prisma.webPushSubscription.updateMany({ where: { id: { in: [...new Set(okWeb)] } }, data: { lastUsedAt: now } });
  return cleared;
}
