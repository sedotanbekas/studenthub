import { errors, jwtVerify, SignJWT } from "jose";
import { getEnv } from "@/lib/env";
import { unauthorized } from "@/lib/http/errors";

/** Access token JWT HS256 berumur pendek; hanya memuat sub (userId) & sid (sessionId). */
export const ACCESS_TOKEN_TTL_SECONDS = 900;
export const JWT_ISSUER = "studenthub";
export const JWT_AUDIENCE = "studenthub-api";
const CLOCK_TOLERANCE_SECONDS = 30;

export type AccessClaims = { sub: string; sid: string };

const key = (): Uint8Array => new TextEncoder().encode(getEnv().JWT_ACCESS_SECRET);

export async function signAccessToken(claims: AccessClaims, now: Date): Promise<{ token: string; expiresAt: Date }> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const expiresAtSeconds = issuedAt + ACCESS_TOKEN_TTL_SECONDS;
  const token = await new SignJWT({ sid: claims.sid })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.sub)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAtSeconds)
    .sign(key());
  return { token, expiresAt: new Date(expiresAtSeconds * 1000) };
}

export async function verifyAccessToken(token: string, now: Date = new Date()): Promise<AccessClaims> {
  try {
    const { payload } = await jwtVerify(token, key(), {
      algorithms: ["HS256"],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      currentDate: now,
    });
    if (typeof payload.sub !== "string" || typeof payload.sid !== "string") {
      throw unauthorized("UNAUTHENTICATED", "Token tidak valid.");
    }
    return { sub: payload.sub, sid: payload.sid };
  } catch (error) {
    if (error instanceof errors.JWTExpired) throw unauthorized("TOKEN_EXPIRED", "Sesi kedaluwarsa. Perbarui token.");
    throw unauthorized("UNAUTHENTICATED", "Token tidak valid.");
  }
}
