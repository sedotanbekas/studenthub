import type { SessionRevokeReason } from "@prisma/client";
import type { Tx } from "@/lib/db";

/**
 * Pencabutan sesi (idempoten). Token push sesi ikut dihapus agar HP tidak lagi menerima
 * notifikasi akun tersebut. Efek berlaku pada request berikutnya (getAuth memeriksa AuthSession).
 */
export async function revokeSession(tx: Tx, sessionId: string, reason: SessionRevokeReason, now: Date): Promise<boolean> {
  const result = await tx.authSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: now, revokeReason: reason, expoPushToken: null },
  });
  return result.count > 0;
}

export async function revokeAllSessions(
  tx: Tx,
  userId: string,
  reason: SessionRevokeReason,
  now: Date,
  exceptSessionId?: string,
): Promise<number> {
  const result = await tx.authSession.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: now, revokeReason: reason, expoPushToken: null },
  });
  return result.count;
}

/** Cabut semua sesi seluruh pengguna satu sekolah (mis. sekolah dinonaktifkan). */
export async function revokeSchoolSessions(tx: Tx, schoolId: string, reason: SessionRevokeReason, now: Date): Promise<number> {
  const result = await tx.authSession.updateMany({
    where: { revokedAt: null, user: { schoolId } },
    data: { revokedAt: now, revokeReason: reason, expoPushToken: null },
  });
  return result.count;
}
