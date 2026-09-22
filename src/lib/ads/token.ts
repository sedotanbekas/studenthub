import { jwtVerify, SignJWT } from "jose";
import { AD_TOKEN_AUDIENCE, AD_TOKEN_ISSUER, AD_TOKEN_TTL_SECONDS } from "./constants";

/**
 * Token event iklan: JWT HS256 dengan rahasia TERSENDIRI (AD_EVENT_SECRET) dan audiens khusus sehingga
 * tidak pernah tertukar dengan access token. Terikat pada siswa, iklan, sponsor, dan sekolah saat
 * ditayangkan; berlaku 6 jam. Impresi/klik untuk iklan yang tidak pernah ditayangkan ke siswa itu tidak
 * bisa dipalsukan, dan token siswa lain ditolak (u != pemanggil).
 */
export interface AdTokenClaims {
  readonly adId: string;
  readonly sponsorId: string;
  readonly userId: string;
  readonly schoolId: string;
}

const TOKEN_VERSION = 1;
const encode = (secret: string): Uint8Array => new TextEncoder().encode(secret);
const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 64;

export async function signAdToken(claims: AdTokenClaims, secret: string, now: Date): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  return new SignJWT({ v: TOKEN_VERSION, a: claims.adId, sp: claims.sponsorId, u: claims.userId, sc: claims.schoolId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(AD_TOKEN_ISSUER)
    .setAudience(AD_TOKEN_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + AD_TOKEN_TTL_SECONDS)
    .sign(encode(secret));
}

/** Klaim token bila sah & belum kedaluwarsa; null untuk apa pun yang tidak sah (tanpa membocorkan alasan). */
export async function verifyAdToken(token: string, secret: string, now: Date): Promise<AdTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, encode(secret), {
      algorithms: ["HS256"],
      issuer: AD_TOKEN_ISSUER,
      audience: AD_TOKEN_AUDIENCE,
      currentDate: now,
      requiredClaims: ["exp", "iat"],
    });
    const { v, a, sp, u, sc } = payload as Record<string, unknown>;
    if (v !== TOKEN_VERSION || !isText(a) || !isText(sp) || !isText(u) || !isText(sc)) return null;
    return { adId: a, sponsorId: sp, userId: u, schoolId: sc };
  } catch {
    return null;
  }
}
