import type { ClientPlatform, SessionRevokeReason, UserRole } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { notFound, unprocessable } from "@/lib/http/errors";
import { userLockKey } from "@/lib/lock-keys";
import { lockKey, withTx } from "@/lib/tx";
import { EXPO_PUSH_TOKEN_PATTERN, SESSION_LIST_MAX } from "./constants";
import { isMobilePlatform, planLoginRevocations } from "./device";
import { toSessionItem, type IssuedSession } from "./dto";
import type { SessionItem } from "./auth-schemas";
import { requirePrincipal, type ActionContext } from "./principal";
import { generateRefreshToken, refreshExpiry, sessionExpiry } from "./refresh-rules";
import { revokeAllSessions, revokeSession } from "./sessions";

/**
 * Layanan sesi: pembuatan sesi login (dipanggil login-service di dalam transaksinya), logout,
 * daftar/cabut sesi sendiri, dan token push Expo per sesi.
 */
const IP_MAX = 45;
const USER_AGENT_MAX = 255;
const UNIQUE_VIOLATION = "P2002";

/** Kunci aplikasi per user: menyerialkan login paralel agar batas sesi & satu-HP-per-siswa konsisten. */
export function userSessionLockKey(userId: string): string {
  return userLockKey(userId);
}

export async function lockUserSessions(tx: Tx, userId: string): Promise<void> {
  await lockKey(tx, userSessionLockKey(userId));
}

/** Satu kali ulang bila bentrok unik (mis. token push dipindah bersamaan dari sesi lain). */
export async function retryOnUniqueConflict<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code !== UNIQUE_VIOLATION) throw error;
    return fn();
  }
}

const revokedData = (reason: SessionRevokeReason, now: Date) => ({ revokedAt: now, revokeReason: reason, expoPushToken: null });

/** Lepas token push dari sesi lain yang memegangnya (HP sama, akun sebelumnya). */
export async function releasePushToken(tx: Tx, expoPushToken: string, exceptSessionId: string | null): Promise<void> {
  await tx.authSession.updateMany({
    where: { expoPushToken, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { expoPushToken: null },
  });
}

export interface NewSessionInput {
  readonly userId: string;
  readonly role: UserRole;
  readonly platform: ClientPlatform;
  readonly deviceId: string | null;
  readonly deviceName: string | null;
  readonly expoPushToken: string | null;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly now: Date;
}

/** Cabut sesi yang digantikan login baru: perangkat sama (semua user), satu HP per siswa, batas per peran. */
async function revokeReplacedSessions(tx: Tx, input: NewSessionInput): Promise<void> {
  const replaced = revokedData("REPLACED", input.now);
  if (isMobilePlatform(input.platform) && input.deviceId !== null) {
    await tx.authSession.updateMany({
      where: { deviceId: input.deviceId, revokedAt: null, userId: { not: input.userId } },
      data: replaced,
    });
  }
  const liveSessions = await tx.authSession.findMany({
    where: { userId: input.userId, revokedAt: null, expiresAt: { gt: input.now } },
    select: { id: true, platform: true, deviceId: true, lastUsedAt: true, createdAt: true },
  });
  const ids = planLoginRevocations({ role: input.role, platform: input.platform, deviceId: input.deviceId, liveSessions });
  if (ids.length > 0) await tx.authSession.updateMany({ where: { id: { in: ids }, revokedAt: null }, data: replaced });
}

/**
 * Membuat AuthSession + RefreshToken pertama. Pemanggil WAJIB sudah memegang lockUserSessions(userId)
 * di transaksi yang sama.
 */
export async function openSession(tx: Tx, input: NewSessionInput): Promise<IssuedSession> {
  await revokeReplacedSessions(tx, input);
  if (input.expoPushToken !== null) await releasePushToken(tx, input.expoPushToken, null);
  const expiresAt = sessionExpiry(input.now, input.platform);
  const session = await tx.authSession.create({
    data: {
      userId: input.userId,
      platform: input.platform,
      deviceId: input.deviceId,
      deviceName: input.deviceName,
      expoPushToken: input.expoPushToken,
      ipAddress: input.ip?.slice(0, IP_MAX) ?? null,
      userAgent: input.userAgent?.slice(0, USER_AGENT_MAX) ?? null,
      lastUsedAt: input.now,
      expiresAt,
    },
    select: { id: true },
  });
  const token = generateRefreshToken();
  const refreshTokenExpiresAt = refreshExpiry(input.now, input.platform, expiresAt);
  await tx.refreshToken.create({ data: { sessionId: session.id, tokenHash: token.hash, expiresAt: refreshTokenExpiresAt } });
  return { sessionId: session.id, refreshToken: token.raw, refreshTokenExpiresAt };
}

/** Metadata klien terbaru untuk sesi (tidak menimpa dengan null bila header tidak ada). */
export function clientMetaUpdate(ip: string | null, userAgent: string | null): { ipAddress?: string; userAgent?: string } {
  return {
    ...(ip ? { ipAddress: ip.slice(0, IP_MAX) } : {}),
    ...(userAgent ? { userAgent: userAgent.slice(0, USER_AGENT_MAX) } : {}),
  };
}

// ----------------------------------------------------------------------------- logout & sesi sendiri

export async function logoutCurrent(ctx: ActionContext): Promise<{ revoked: true }> {
  const principal = requirePrincipal(ctx);
  await withTx((tx) => revokeSession(tx, principal.sessionId, "LOGOUT", ctx.now));
  return { revoked: true };
}

export async function logoutEverywhere(ctx: ActionContext): Promise<{ revokedCount: number }> {
  const principal = requirePrincipal(ctx);
  const revokedCount = await withTx((tx) => revokeAllSessions(tx, principal.userId, "LOGOUT", ctx.now));
  return { revokedCount };
}

export async function listOwnSessions(ctx: ActionContext): Promise<SessionItem[]> {
  const principal = requirePrincipal(ctx);
  const rows = await prisma.authSession.findMany({
    where: { userId: principal.userId, revokedAt: null, expiresAt: { gt: ctx.now } },
    select: { id: true, platform: true, deviceName: true, ipAddress: true, lastUsedAt: true, createdAt: true },
    orderBy: [{ lastUsedAt: "desc" }, { id: "asc" }],
    take: SESSION_LIST_MAX,
  });
  return rows.map((row) => toSessionItem(row, principal.sessionId));
}

/** Cabut satu sesi milik sendiri; sesi user lain -> 404 (tidak membocorkan keberadaan). Idempoten. */
export async function revokeOwnSession(sessionId: string, ctx: ActionContext): Promise<{ revoked: true }> {
  const principal = requirePrincipal(ctx);
  const session = await prisma.authSession.findFirst({
    where: { id: sessionId, userId: principal.userId },
    select: { id: true, revokedAt: true },
  });
  if (!session) throw notFound("Sesi tidak ditemukan.");
  if (session.revokedAt === null) await withTx((tx) => revokeSession(tx, session.id, "LOGOUT", ctx.now));
  return { revoked: true };
}

// ----------------------------------------------------------------------------- token push

function assertMobileSession(platform: ClientPlatform): void {
  if (!isMobilePlatform(platform)) {
    throw unprocessable("PUSH_TOKEN_WEB_SESSION", "Token push hanya dapat dipasang pada sesi aplikasi mobile (ANDROID/IOS).");
  }
}

/** Pasang token Expo di sesi saat ini; dilepas dulu dari sesi lain yang memegangnya (satu HP = satu sesi). */
export async function registerPushToken(expoPushToken: string, ctx: ActionContext): Promise<{ registered: true }> {
  const principal = requirePrincipal(ctx);
  assertMobileSession(principal.platform);
  if (!EXPO_PUSH_TOKEN_PATTERN.test(expoPushToken)) {
    throw unprocessable("PUSH_TOKEN_INVALID", "Format token push Expo tidak valid.");
  }
  await retryOnUniqueConflict(() =>
    withTx(async (tx) => {
      await releasePushToken(tx, expoPushToken, principal.sessionId);
      await tx.authSession.updateMany({ where: { id: principal.sessionId, revokedAt: null }, data: { expoPushToken } });
    }),
  );
  return { registered: true };
}

export async function removePushToken(ctx: ActionContext): Promise<{ removed: true }> {
  const principal = requirePrincipal(ctx);
  assertMobileSession(principal.platform);
  await withTx((tx) => tx.authSession.updateMany({ where: { id: principal.sessionId }, data: { expoPushToken: null } }));
  return { removed: true };
}
