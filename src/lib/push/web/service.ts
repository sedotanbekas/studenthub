import { requirePrincipal, type ActionContext } from "@/lib/auth/principal";
import { lockUserSessions, retryOnUniqueConflict } from "@/lib/auth/session-service";
import { prisma, type Tx } from "@/lib/db";
import { unauthorized, unprocessable } from "@/lib/http/errors";
import { log } from "@/lib/log";
import { lockRows, withTx } from "@/lib/tx";
import { webPushSettings } from "../transport";
import { checkPushEndpoint, endpointHashOf, isValidSubscriptionKeys } from "./rules";
import type { UpsertWebPushBody, WebPushStatusDto, WebPushSubscribedDto } from "./schemas";

/**
 * Langganan Web Push sesi web pemanggil (N3). Tidak ber-schoolId: baris SELALU dikunci ke `sessionId`/`userId`
 * principal. Tanpa AuditLog/notifikasi (setara token push Expo). Endpoint tidak pernah dilog — hanya host.
 */

export async function getMyWebPushStatus(ctx: ActionContext): Promise<WebPushStatusDto> {
  const principal = requirePrincipal(ctx);
  const settings = webPushSettings();
  if (settings.mode === "off") return { enabled: false, publicKey: null, subscribed: false };
  const subscribed = (await prisma.webPushSubscription.count({ where: { sessionId: principal.sessionId } })) > 0;
  return { enabled: true, publicKey: settings.publicKey, subscribed };
}

function assertSubscribable(body: UpsertWebPushBody, ctx: ActionContext): void {
  if (requirePrincipal(ctx).platform !== "WEB") throw unprocessable("WEB_PUSH_APP_SESSION", "Langganan notifikasi browser hanya untuk sesi web.");
  if (webPushSettings().mode === "off") throw unprocessable("WEB_PUSH_DISABLED", "Notifikasi HP belum aktif di server ini.");
  if (!checkPushEndpoint(body.endpoint) || !isValidSubscriptionKeys(body.keys)) throw unprocessable("WEB_PUSH_ENDPOINT_INVALID", "Alamat langganan notifikasi tidak dikenali.");
}

/**
 * Urutan kunci = login/ganti sandi/nonaktif: AppLock user -> AuthSession (FOR UPDATE) -> WebPushSubscription (+ S
 * lock FK User/AuthSession).
 * Sesi dibaca ulang di bawah kunci: logout yang menang lebih dulu -> 401. Endpoint yang sama milik sesi/akun lain
 * (ganti akun di browser yang sama) dipindah ke sesi ini lewat upsert endpointHash.
 */
async function saveSubscription(tx: Tx, body: UpsertWebPushBody, hash: string, ctx: ActionContext): Promise<void> {
  const { userId, sessionId } = requirePrincipal(ctx);
  await lockUserSessions(tx, userId);
  // FOR UPDATE: logout bersamaan (UPDATE AuthSession) menunggu commit ini lalu menghapus barisnya, atau sebaliknya
  // baca ulang di bawah ini melihat sesi sudah dicabut -> 401. Tidak pernah ada baris tertinggal di sesi dicabut.
  await lockRows(tx, "AuthSession", [sessionId]);
  const live = await tx.authSession.findFirst({ where: { id: sessionId, userId, revokedAt: null, expiresAt: { gt: ctx.now } }, select: { id: true } });
  if (!live) throw unauthorized("SESSION_INVALID", "Sesi berakhir. Silakan masuk kembali.");
  await tx.webPushSubscription.deleteMany({ where: { sessionId, endpointHash: { not: hash } } });
  const fields = { userId, sessionId, endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth, userAgent: ctx.userAgent?.slice(0, 255) ?? null, lastUsedAt: ctx.now };
  await tx.webPushSubscription.upsert({ where: { endpointHash: hash }, create: { ...fields, endpointHash: hash }, update: fields });
}

export async function upsertMyWebPushSubscription(body: UpsertWebPushBody, ctx: ActionContext): Promise<WebPushSubscribedDto> {
  assertSubscribable(body, ctx);
  const hash = endpointHashOf(body.endpoint);
  await retryOnUniqueConflict(() => withTx((tx) => saveSubscription(tx, body, hash, ctx)));
  log.info("webpush.subscribed", { userId: requirePrincipal(ctx).userId, host: new URL(body.endpoint).host, requestId: ctx.requestId });
  return { subscribed: true };
}

/** Idempoten: tanpa langganan pun tetap 200. */
export async function removeMyWebPushSubscription(ctx: ActionContext): Promise<WebPushSubscribedDto> {
  const { sessionId } = requirePrincipal(ctx);
  await withTx((tx) => tx.webPushSubscription.deleteMany({ where: { sessionId } }));
  return { subscribed: false };
}
