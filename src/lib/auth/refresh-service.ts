import type { ClientPlatform, StudentStatus, UserRole } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { conflict, unauthorized } from "@/lib/http/errors";
import { withTx } from "@/lib/tx";
import { signAccessToken } from "./access-token";
import type { AuthTokens } from "./auth-schemas";
import { ACCOUNT_INACTIVE_MESSAGE, SESSION_INVALID_MESSAGE } from "./constants";
import { toAuthTokens, type IssuedSession } from "./dto";
import type { ActionContext } from "./principal";
import { checkLoginEligibility } from "./principal-rules";
import { decideRefresh, generateRefreshToken, hashRefreshToken, refreshExpiry, type RefreshDecision } from "./refresh-rules";
import { clientMetaUpdate } from "./session-service";
import { revokeSession } from "./sessions";

/**
 * POST /auth/refresh: rotasi refresh token dengan deteksi reuse (docs/design/01 aturan 5).
 * Kontrak untuk klien Expo: refresh single-flight; 409 REFRESH_RACE -> baca ulang token tersimpan
 * lalu ulangi sekali; 401 SESSION_INVALID/ACCOUNT_INACTIVE -> kembali ke layar login.
 */
interface TokenRow {
  readonly id: string;
  readonly rotatedAt: Date | null;
  readonly expiresAt: Date;
  readonly session: {
    readonly id: string;
    readonly userId: string;
    readonly platform: ClientPlatform;
    readonly revokedAt: Date | null;
    readonly expiresAt: Date;
    readonly user: {
      readonly id: string;
      readonly name: string;
      readonly role: UserRole;
      readonly schoolId: string | null;
      readonly sponsorId: string | null;
      readonly isActive: boolean;
      readonly mustChangePassword: boolean;
      readonly school: { readonly isActive: boolean } | null;
      readonly student: { readonly status: StudentStatus } | null;
    };
  };
}

const sessionInvalid = () => unauthorized("SESSION_INVALID", SESSION_INVALID_MESSAGE);

function loadToken(tokenHash: string): Promise<TokenRow | null> {
  return prisma.refreshToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      rotatedAt: true,
      expiresAt: true,
      session: {
        select: {
          id: true,
          userId: true,
          platform: true,
          revokedAt: true,
          expiresAt: true,
          user: {
            select: {
              id: true,
              name: true,
              role: true,
              schoolId: true,
              sponsorId: true,
              isActive: true,
              mustChangePassword: true,
              school: { select: { isActive: true } },
              student: { select: { status: true } },
            },
          },
        },
      },
    },
  });
}

/** REUSE: cabut seluruh sesi (TOKEN_REUSE) + audit di transaksi yang sama. */
async function revokeForReuse(row: TokenRow, ctx: ActionContext): Promise<void> {
  await withTx(async (tx) => {
    const revoked = await revokeSession(tx, row.session.id, "TOKEN_REUSE", ctx.now);
    if (!revoked) return;
    await writeAudit(
      tx,
      {
        action: "auth.token_reuse",
        entityType: "AuthSession",
        entityId: row.session.id,
        schoolId: row.session.user.schoolId,
        after: { userId: row.session.userId, refreshTokenId: row.id, rotatedAt: row.rotatedAt, reason: "TOKEN_REUSE" },
      },
      { principal: null, ip: ctx.ip, userAgent: ctx.userAgent },
    );
  });
}

async function rejectRefresh(decision: Exclude<RefreshDecision, "ROTATE">, row: TokenRow, ctx: ActionContext): Promise<never> {
  if (decision === "RACE") {
    throw conflict("REFRESH_RACE", "Token sedang diperbarui oleh permintaan lain. Pakai token terbaru yang tersimpan lalu coba lagi.");
  }
  if (decision === "REUSE") await revokeForReuse(row, ctx);
  throw sessionInvalid();
}

/** Akun tidak lagi layak -> cabut sesi (ACCOUNT_DISABLED), 401 ACCOUNT_INACTIVE. */
async function assertStillEligible(row: TokenRow, now: Date): Promise<void> {
  const { user } = row.session;
  const eligibility = checkLoginEligibility({
    isActive: user.isActive,
    role: user.role,
    schoolActive: user.school ? user.school.isActive : null,
    studentStatus: user.student?.status ?? null,
  });
  if (eligibility.ok) return;
  await withTx((tx) => revokeSession(tx, row.session.id, "ACCOUNT_DISABLED", now));
  throw unauthorized("ACCOUNT_INACTIVE", ACCOUNT_INACTIVE_MESSAGE);
}

/** Compare-and-set rotatedAt; null = kalah balapan (token sudah dirotasi permintaan lain). */
function rotate(row: TokenRow, ctx: ActionContext): Promise<IssuedSession | null> {
  return withTx(async (tx) => {
    const cas = await tx.refreshToken.updateMany({ where: { id: row.id, rotatedAt: null }, data: { rotatedAt: ctx.now } });
    if (cas.count === 0) return null;
    const touched = await tx.authSession.updateMany({
      where: { id: row.session.id, revokedAt: null },
      data: { lastUsedAt: ctx.now, ...clientMetaUpdate(ctx.ip, ctx.userAgent) },
    });
    if (touched.count === 0) throw sessionInvalid();
    const token = generateRefreshToken();
    const expiresAt = refreshExpiry(ctx.now, row.session.platform, row.session.expiresAt);
    await tx.refreshToken.create({ data: { sessionId: row.session.id, tokenHash: token.hash, expiresAt } });
    return { sessionId: row.session.id, refreshToken: token.raw, refreshTokenExpiresAt: expiresAt };
  });
}

/** Kalah CAS: baca ulang di luar transaksi lalu putuskan lagi (RACE atau REUSE). */
async function rejectLostRotation(row: TokenRow, ctx: ActionContext): Promise<never> {
  const fresh = await prisma.refreshToken.findUnique({
    where: { id: row.id },
    select: { rotatedAt: true, expiresAt: true, session: { select: { revokedAt: true, expiresAt: true } } },
  });
  if (!fresh) throw sessionInvalid();
  const decision = decideRefresh(fresh, fresh.session, ctx.now);
  return rejectRefresh(decision === "ROTATE" ? "RACE" : decision, { ...row, rotatedAt: fresh.rotatedAt }, ctx);
}

export async function refreshSession(rawToken: string, ctx: ActionContext): Promise<AuthTokens> {
  const row = await loadToken(hashRefreshToken(rawToken));
  if (!row) throw sessionInvalid();
  const decision = decideRefresh(row, row.session, ctx.now);
  if (decision !== "ROTATE") return rejectRefresh(decision, row, ctx);
  await assertStillEligible(row, ctx.now);
  const issued = await rotate(row, ctx);
  if (!issued) return rejectLostRotation(row, ctx);
  const { user } = row.session;
  const access = await signAccessToken({ sub: user.id, sid: row.session.id }, ctx.now);
  return toAuthTokens(access, issued, user);
}
