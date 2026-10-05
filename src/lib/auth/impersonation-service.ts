import { writeAudit } from "@/lib/audit";
import { prisma, type Tx } from "@/lib/db";
import { conflict, forbidden, notFound } from "@/lib/http/errors";
import { withTx } from "@/lib/tx";
import { signAccessToken } from "./access-token";
import type { AuthTokens } from "./auth-schemas";
import { toAuthTokens, type IssuedSession } from "./dto";
import { impersonationExpiry, impersonationRefusal } from "./impersonation-rules";
import { ACCOUNT_INACTIVE_MESSAGES } from "./login-service";
import { requirePrincipal, type ActionContext, type Principal } from "./principal";
import { generateRefreshToken } from "./refresh-rules";
import { clientMetaUpdate, lockUserSessions } from "./session-service";
import { revokeSession } from "./sessions";

/**
 * "Masuk sebagai" (pemilik 2026-10-05). Mulai: kunci sesi user target -> baca & periksa target -> sesi WEB terpisah
 * (impersonatorId = super admin, 30 menit, TANPA mengusir sesi asli pemilik akun, tanpa deviceId sehingga tidak pernah
 * mengikat perangkat absen) + audit, satu transaksi. Akhiri: cabut sesi itu + audit. Tidak memperbarui lastLoginAt dan
 * tidak tercatat di riwayat masuk pemilik akun.
 */
const IMPERSONATION_DEVICE_NAME = "Masuk sebagai (super admin)";

const TARGET_SELECT = {
  id: true,
  name: true,
  role: true,
  isActive: true,
  schoolId: true,
  sponsorId: true,
  mustChangePassword: true,
  school: { select: { isActive: true } },
  student: { select: { status: true } },
} as const;

type TargetRow = NonNullable<Awaited<ReturnType<typeof loadTarget>>>;

function loadTarget(tx: Tx, id: string) {
  return tx.user.findUnique({ where: { id }, select: TARGET_SELECT });
}

function assertImpersonable(target: TargetRow): void {
  const refusal = impersonationRefusal({
    id: target.id,
    role: target.role,
    isActive: target.isActive,
    schoolActive: target.school ? target.school.isActive : null,
    studentStatus: target.student?.status ?? null,
  });
  if (refusal?.code === "IMPERSONATION_NOT_ALLOWED") throw forbidden("IMPERSONATION_NOT_ALLOWED", "Akun super admin tidak dapat dibuka lewat Masuk sebagai.");
  if (refusal) throw forbidden("ACCOUNT_INACTIVE", ACCOUNT_INACTIVE_MESSAGES[refusal.reason], { reason: refusal.reason });
}

async function openImpersonationSession(tx: Tx, target: TargetRow, actor: Principal, ctx: ActionContext): Promise<IssuedSession> {
  const expiresAt = impersonationExpiry(ctx.now);
  const session = await tx.authSession.create({
    data: {
      userId: target.id,
      impersonatorId: actor.userId,
      platform: "WEB",
      deviceId: null,
      deviceName: IMPERSONATION_DEVICE_NAME,
      ...clientMetaUpdate(ctx.ip, ctx.userAgent),
      lastUsedAt: ctx.now,
      expiresAt,
    },
    select: { id: true },
  });
  const token = generateRefreshToken();
  await tx.refreshToken.create({ data: { sessionId: session.id, tokenHash: token.hash, expiresAt } });
  return { sessionId: session.id, refreshToken: token.raw, refreshTokenExpiresAt: expiresAt };
}

/** POST /platform/users/{id}/impersonate: token sesi atas nama target (diambil alih proxy web menjadi cookie). */
export async function startImpersonation(targetId: string, ctx: ActionContext): Promise<AuthTokens> {
  const actor = requirePrincipal(ctx);
  const { target, session } = await withTx(async (tx) => {
    await lockUserSessions(tx, targetId);
    const row = await loadTarget(tx, targetId);
    if (!row) throw notFound("Pengguna tidak ditemukan.");
    assertImpersonable(row);
    const opened = await openImpersonationSession(tx, row, actor, ctx);
    const after = { sessionId: opened.sessionId, role: row.role, expiresAt: opened.refreshTokenExpiresAt.toISOString() };
    // schoolId akun target: sekolah ikut melihat bahwa super admin membuka akunnya (transparansi).
    await writeAudit(tx, { action: "user.impersonate_start", entityType: "User", entityId: row.id, schoolId: row.schoolId, after }, ctx);
    return { target: row, session: opened };
  });
  const access = await signAccessToken({ sub: target.id, sid: session.sessionId }, ctx.now);
  return toAuthTokens(access, session, target);
}

/** POST /auth/impersonation/end: hanya untuk sesi "Masuk sebagai" (sesi biasa -> 409 NOT_IMPERSONATING). */
export async function endImpersonation(ctx: ActionContext): Promise<{ ended: true }> {
  const principal = requirePrincipal(ctx);
  if (principal.impersonatorId === null) throw conflict("NOT_IMPERSONATING", "Sesi ini bukan sesi Masuk sebagai.");
  const impersonatorId = principal.impersonatorId;
  // Dicatat atas nama super admin yang sebenarnya bertindak (bukan pemilik akun), di sekolah akun tersebut.
  const actor = { ...ctx, principal: { ...principal, userId: impersonatorId, role: "SUPER_ADMIN" as const, impersonatorId: null } };
  await withTx(async (tx) => {
    await revokeSession(tx, principal.sessionId, "LOGOUT", ctx.now);
    const after = { sessionId: principal.sessionId };
    await writeAudit(tx, { action: "user.impersonate_end", entityType: "User", entityId: principal.userId, schoolId: principal.schoolId, after }, actor);
  });
  return { ended: true };
}

/** Penanda untuk /auth/me: siapa super admin yang membuka sesi ini dan kapan berakhir (null = sesi biasa). */
export async function loadImpersonation(principal: Principal): Promise<{ by: { id: string; name: string }; expiresAt: string } | null> {
  if (principal.impersonatorId === null) return null;
  const session = await prisma.authSession.findUnique({
    where: { id: principal.sessionId },
    select: { expiresAt: true, impersonator: { select: { id: true, name: true } } },
  });
  if (!session?.impersonator) return null;
  return { by: session.impersonator, expiresAt: session.expiresAt.toISOString() };
}
