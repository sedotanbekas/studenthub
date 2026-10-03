import type { JobContext } from "@/lib/auth/principal";
import { log } from "@/lib/log";
import { claimPendingBatch, scopedUserIds, type Claim, type ClaimedNotification } from "./claim";
import { PUSH_BATCH, PUSH_DISPATCH_BUDGET_MS, PUSH_ERROR } from "./constants";
import { buildDeliveries, clearUnregisteredTokens, loadDevices, sendDeliveries, unreadCountsFor, type Delivery, type DeliveryTransports } from "./delivery";
import { applyOutcomes, releaseClaims, type NotificationOutcome } from "./outcomes";
import { aggregateOutcome, isExpired, unsentNotificationIds, type DeviceResult } from "./rules";
import { getPushTransport, getWebPushTransport } from "./transport";
import type { PushTransport } from "./types";
import type { WebPushTransport } from "./web/types";

/**
 * Dispatcher outbox push (desain 05 P2, disederhanakan PLAN: tanpa tabel receipt). Satu putaran:
 * klaim <= 500 baris PENDING jatuh tempo (terlama dulu) -> kedaluwarsa (> 60 menit) SKIPPED "EXPIRED" ->
 * penerima tanpa perangkat (sesi bertoken Expo / langganan Web Push sesi hidup, N3) SKIPPED "NO_DEVICE" -> kirim per
 * 100 (Expo & web paralel) -> DeviceNotRegistered / 404-410 melepas perangkat itu -> hasil per notifikasi
 * (SENT / PENDING + backoff / FAILED). Semua peran diantre PENDING (N3); badge web = jumlah belum dibaca. Diulang sampai habis atau anggaran
 * waktu (min(ctx.deadline, 40 detik)) terpakai — dicek juga sebelum setiap chunk; notifikasi yang belum sempat
 * dikirim dilepas (jatuh tempo lagi, percobaan tidak bertambah). Aman dijalankan paralel (klaim SKIP LOCKED +
 * update terjaga).
 */
export interface DispatchSummary {
  readonly claimed: number;
  readonly sent: number;
  readonly retried: number;
  readonly failed: number;
  readonly skipped: number;
  readonly expired: number;
  /** Dilepas tanpa dikirim karena anggaran waktu habis (jatuh tempo lagi, percobaan tidak bertambah). */
  readonly released: number;
  readonly tokensCleared: number;
}

export const EMPTY_DISPATCH_SUMMARY: DispatchSummary = { claimed: 0, sent: 0, retried: 0, failed: 0, skipped: 0, expired: 0, released: 0, tokensCleared: 0 };

export function mergeDispatchSummary(a: DispatchSummary, b: DispatchSummary): DispatchSummary {
  return {
    claimed: a.claimed + b.claimed,
    sent: a.sent + b.sent,
    retried: a.retried + b.retried,
    failed: a.failed + b.failed,
    skipped: a.skipped + b.skipped,
    expired: a.expired + b.expired,
    released: a.released + b.released,
    tokensCleared: a.tokensCleared + b.tokensCleared,
  };
}

const skip = (rows: readonly ClaimedNotification[], error: string): NotificationOutcome[] =>
  rows.map((row) => ({ id: row.id, outcome: { status: "SKIPPED", error } }));

function outcomesOf(rows: readonly ClaimedNotification[], deliveries: readonly Delivery[], results: readonly DeviceResult[], now: Date): NotificationOutcome[] {
  const byNotification = new Map<string, DeviceResult[]>();
  deliveries.forEach((d, i) => {
    const result = results[i];
    if (result) byNotification.set(d.notificationId, [...(byNotification.get(d.notificationId) ?? []), result]);
  });
  return rows.map((row) => ({ id: row.id, outcome: aggregateOutcome(byNotification.get(row.id) ?? [], row.pushAttempts, now) }));
}

async function processClaim(claim: Claim, now: Date, transports: DeliveryTransports, deadline: number): Promise<DispatchSummary> {
  const expired = claim.rows.filter((row) => isExpired(row, now));
  const live = claim.rows.filter((row) => !isExpired(row, now));
  const devices = await loadDevices([...new Set(live.map((row) => row.userId))], now, { web: transports.web !== null });
  const reachable = live.filter((row) => devices.has(row.userId));
  const unreachable = live.filter((row) => !devices.has(row.userId));
  const expiredCounts = await applyOutcomes(skip(expired, PUSH_ERROR.EXPIRED), claim.leaseUntil, now);
  const webUsers = [...devices].filter(([, list]) => list.some((d) => d.kind === "web")).map(([userId]) => userId);
  const deliveries = buildDeliveries(reachable, devices, now, await unreadCountsFor(webUsers));
  const results = await sendDeliveries(deliveries, transports, deadline);
  const tokensCleared = await clearUnregisteredTokens(deliveries.slice(0, results.length), results, now);
  const unsent = unsentNotificationIds(deliveries, results);
  const released = await releaseClaims([...unsent], claim.leaseUntil, now);
  const attempted = reachable.filter((row) => !unsent.has(row.id));
  const counts = await applyOutcomes([...skip(unreachable, PUSH_ERROR.NO_DEVICE), ...outcomesOf(attempted, deliveries, results, now)], claim.leaseUntil, now);
  return { claimed: claim.rows.length, ...counts, expired: expiredCounts.skipped, released, tokensCleared };
}

export async function dispatchPendingPushes(
  ctx: JobContext,
  transport: PushTransport = getPushTransport(),
  webTransport: WebPushTransport | null = getWebPushTransport(),
): Promise<DispatchSummary> {
  const userIds = await scopedUserIds(ctx.scope);
  if (userIds !== null && userIds.length === 0) return EMPTY_DISPATCH_SUMMARY;
  const deadline = Math.min(ctx.deadline, Date.now() + PUSH_DISPATCH_BUDGET_MS);
  let summary = EMPTY_DISPATCH_SUMMARY;
  while (Date.now() < deadline) {
    const claim = await claimPendingBatch(ctx.now, userIds);
    if (claim.rows.length === 0) break;
    const pass = await processClaim(claim, ctx.now, { expo: transport, web: webTransport }, deadline);
    summary = mergeDispatchSummary(summary, pass);
    if (claim.rows.length < PUSH_BATCH || pass.released > 0) break;
  }
  if (summary.claimed > 0) log.info("push.dispatch", { requestId: ctx.requestId, transport: transport.name, web: webTransport?.name ?? "off", ...summary });
  return summary;
}
