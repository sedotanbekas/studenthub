import { prisma } from "@/lib/db";
import { unauthorized } from "@/lib/http/errors";
import { verifyAccessToken } from "./access-token";
import type { Principal } from "./principal";
import { evaluatePrincipal, type SessionRow } from "./principal-rules";

/**
 * Autentikasi request: hanya `Authorization: Bearer <access token>`. Skema lain (mis. Basic dari
 * halaman /docs) dianggap anonim. Setiap request memverifikasi baris AuthSession sehingga logout,
 * penonaktifan, dan ganti password berlaku seketika. Transport cookie menyusul di fase dashboard.
 */
export async function getAuth(req: Request, now: Date = new Date()): Promise<Principal | null> {
  const header = req.headers.get("authorization");
  if (!header || !/^Bearer\s+/i.test(header)) return null;
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (token.length === 0) throw unauthorized("UNAUTHENTICATED", "Token tidak valid.");
  const claims = await verifyAccessToken(token, now);
  const row = await loadSession(claims.sid);
  const result = evaluatePrincipal(row, claims, now);
  if (!result.ok) {
    const message = result.code === "SESSION_INVALID" ? "Sesi tidak berlaku. Silakan login ulang." : "Akun tidak aktif.";
    throw unauthorized(result.code, message);
  }
  return result.principal;
}

async function loadSession(sessionId: string): Promise<SessionRow | null> {
  return prisma.authSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      userId: true,
      platform: true,
      deviceId: true,
      revokedAt: true,
      expiresAt: true,
      user: {
        select: {
          id: true,
          role: true,
          name: true,
          isActive: true,
          mustChangePassword: true,
          schoolId: true,
          sponsorId: true,
          school: { select: { isActive: true } },
          student: { select: { id: true, status: true } },
          sponsor: { select: { status: true } },
        },
      },
    },
  });
}
