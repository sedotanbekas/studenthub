import { createHash, randomBytes } from "node:crypto";
import type { ClientPlatform } from "@prisma/client";
import {
  REFRESH_IDLE_TTL_MS,
  REFRESH_RACE_GRACE_MS,
  REFRESH_TOKEN_BYTES,
  SESSION_ABSOLUTE_TTL_MS,
  type PlatformClass,
} from "./constants";

/**
 * Aturan murni rotasi refresh token (tanpa Prisma; jam diinjeksi).
 * - REVOKED : sesi sudah dicabut -> 401 SESSION_INVALID.
 * - RACE    : token sudah dirotasi <= 30 s lalu (dua refresh paralel) -> 409, tanpa token & tanpa cabut.
 * - REUSE   : token sudah dirotasi > 30 s lalu (indikasi pencurian) -> cabut sesi TOKEN_REUSE + audit, 401.
 * - EXPIRED : token atau batas absolut sesi lewat -> 401 SESSION_INVALID.
 * - ROTATE  : lanjut rotasi.
 */
export type RefreshDecision = "ROTATE" | "RACE" | "REUSE" | "EXPIRED" | "REVOKED";

export interface RefreshTokenView {
  readonly rotatedAt: Date | null;
  readonly expiresAt: Date;
}

export interface RefreshSessionView {
  readonly revokedAt: Date | null;
  readonly expiresAt: Date;
}

export function decideRefresh(token: RefreshTokenView, session: RefreshSessionView, now: Date): RefreshDecision {
  const nowMs = now.getTime();
  if (session.revokedAt !== null) return "REVOKED";
  if (token.rotatedAt !== null) {
    return nowMs - token.rotatedAt.getTime() <= REFRESH_RACE_GRACE_MS ? "RACE" : "REUSE";
  }
  if (token.expiresAt.getTime() <= nowMs || session.expiresAt.getTime() <= nowMs) return "EXPIRED";
  return "ROTATE";
}

export function platformClassOf(platform: ClientPlatform): PlatformClass {
  return platform === "WEB" ? "WEB" : "MOBILE";
}

/** Batas umur absolut sesi baru. */
export function sessionExpiry(now: Date, platform: ClientPlatform): Date {
  return new Date(now.getTime() + SESSION_ABSOLUTE_TTL_MS[platformClassOf(platform)]);
}

/** Kedaluwarsa refresh token = min(now + idle, batas absolut sesi). */
export function refreshExpiry(now: Date, platform: ClientPlatform, sessionExpiresAt: Date): Date {
  const idle = now.getTime() + REFRESH_IDLE_TTL_MS[platformClassOf(platform)];
  return new Date(Math.min(idle, sessionExpiresAt.getTime()));
}

/** Hash SHA-256 hex dari token opak (hanya hash yang disimpan di DB). */
export function hashRefreshToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export interface GeneratedRefreshToken {
  readonly raw: string;
  readonly hash: string;
}

/** Token opak 32 byte acak (base64url) + hash-nya. `rand` dapat diinjeksi untuk test. */
export function generateRefreshToken(rand: (size: number) => Uint8Array = randomBytes): GeneratedRefreshToken {
  const raw = Buffer.from(rand(REFRESH_TOKEN_BYTES)).toString("base64url");
  return { raw, hash: hashRefreshToken(raw) };
}
