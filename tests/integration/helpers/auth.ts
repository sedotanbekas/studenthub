/**
 * Membuat sesi login langsung di DB + access token (tanpa lewat endpoint login), untuk menguji
 * route terautentikasi.
 */
import type { ClientPlatform } from "@prisma/client";
import { signAccessToken } from "@/lib/auth/access-token";
import { prisma } from "./db";

export interface SessionOptions {
  readonly platform?: ClientPlatform;
  readonly deviceId?: string | null;
  readonly expiresAt?: Date;
  readonly now?: Date;
}

export interface TestSession {
  readonly sessionId: string;
  readonly token: string;
}

const DAY_MS = 86_400_000;

export async function createSessionToken(userId: string, options: SessionOptions = {}): Promise<TestSession> {
  const now = options.now ?? new Date();
  const session = await prisma.authSession.create({
    data: {
      userId,
      platform: options.platform ?? "ANDROID",
      deviceId: options.deviceId === undefined ? "device-test-0001" : options.deviceId,
      expiresAt: options.expiresAt ?? new Date(now.getTime() + 30 * DAY_MS),
    },
  });
  const { token } = await signAccessToken({ sub: userId, sid: session.id }, now);
  return { sessionId: session.id, token };
}
