import type { StudentStatus, UserRole } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { rateLimitKeyForIp } from "@/lib/http/client-ip";
import { badRequest, forbidden, unauthorized, unprocessable } from "@/lib/http/errors";
import { assertRateLimit, getLimiter } from "@/lib/http/rate-limits";
import { withTx } from "@/lib/tx";
import { signAccessToken } from "./access-token";
import type { AuthTokens, LoginBody } from "./auth-schemas";
import { INVALID_CREDENTIALS_MESSAGE, LOGIN_FAILURE_MIN_MS } from "./constants";
import { decideDeviceBinding, isMobilePlatform } from "./device";
import { toAuthTokens, type IssuedSession } from "./dto";
import { classifyIdentifier, limiterIdentifier, type IdentifierKind } from "./identifier";
import { verifyPassword } from "./password";
import type { ActionContext } from "./principal";
import { checkLoginEligibility, type IneligibleReason } from "./principal-rules";
import { lockUserSessions, openSession, retryOnUniqueConflict } from "./session-service";

/**
 * POST /auth/login. Urutan: validasi input murni -> limiter (sebelum DB) -> cari akun -> tepat satu
 * bcrypt (dummy bila tidak ada) -> gagal: catat kegagalan di 3 limiter + padding >= 300 ms + 401 seragam
 * -> kelayakan akun -> satu transaksi pembuatan sesi -> access token.
 */
const ACCOUNT_INACTIVE_MESSAGES: Readonly<Record<IneligibleReason, string>> = {
  USER_INACTIVE: "Akun Anda dinonaktifkan. Hubungi admin.",
  SCHOOL_INACTIVE: "Sekolah Anda sedang dinonaktifkan. Hubungi admin.",
  STUDENT_DRAFT: "Akun belum diaktivasi sekolah.",
  STUDENT_INACTIVE: "Akun siswa tidak aktif. Hubungi admin sekolah.",
  STUDENT_MOVED: "Akun siswa sudah tidak aktif karena pindah sekolah.",
};

interface LoginAccount {
  readonly userId: string;
  readonly role: UserRole;
  readonly name: string;
  readonly schoolId: string | null;
  readonly sponsorId: string | null;
  readonly isActive: boolean;
  readonly mustChangePassword: boolean;
  readonly tempPasswordExpiresAt: Date | null;
  readonly passwordHash: string;
  readonly schoolActive: boolean | null;
  readonly student: { readonly id: string; readonly schoolId: string; readonly status: StudentStatus; readonly boundDeviceId: string | null } | null;
}

interface LimiterKeys {
  readonly pair: string;
  readonly identifier: string;
  readonly ip: string;
}

const USER_SELECT = {
  id: true,
  role: true,
  name: true,
  schoolId: true,
  sponsorId: true,
  isActive: true,
  mustChangePassword: true,
  tempPasswordExpiresAt: true,
  passwordHash: true,
  school: { select: { isActive: true } },
} as const;

type SelectedUser = {
  id: string;
  role: UserRole;
  name: string;
  schoolId: string | null;
  sponsorId: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  tempPasswordExpiresAt: Date | null;
  passwordHash: string;
  school: { isActive: boolean } | null;
};

function toAccount(user: SelectedUser, student: LoginAccount["student"]): LoginAccount {
  return {
    userId: user.id,
    role: user.role,
    name: user.name,
    schoolId: user.schoolId,
    sponsorId: user.sponsorId,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    tempPasswordExpiresAt: user.tempPasswordExpiresAt,
    passwordHash: user.passwordHash,
    schoolActive: user.school ? user.school.isActive : null,
    student,
  };
}

/** NISN hanya menemukan STUDENT (lewat activeNisn); email hanya menemukan non-STUDENT. */
async function findLoginAccount(identifier: IdentifierKind): Promise<LoginAccount | null> {
  if (identifier.kind === "NISN") {
    const row = await prisma.student.findUnique({
      where: { activeNisn: identifier.nisn },
      select: { id: true, schoolId: true, status: true, boundDeviceId: true, user: { select: USER_SELECT } },
    });
    if (!row || row.user.role !== "STUDENT") return null;
    return toAccount(row.user, { id: row.id, schoolId: row.schoolId, status: row.status, boundDeviceId: row.boundDeviceId });
  }
  if (identifier.kind !== "EMAIL") return null;
  const user = await prisma.user.findFirst({ where: { email: identifier.email, role: { not: "STUDENT" } }, select: USER_SELECT });
  return user ? toAccount(user, null) : null;
}

function limiterKeysOf(ip: string | null, identifier: IdentifierKind): LimiterKeys {
  const ipKey = rateLimitKeyForIp(ip);
  const id = limiterIdentifier(identifier) ?? "invalid";
  return { pair: `login:pair:${ipKey}::${id}`, identifier: `login:id:${id}`, ip: `login:ip:${ipKey}` };
}

function assertNotLocked(keys: LimiterKeys): void {
  assertRateLimit("LOGIN_PAIR", keys.pair);
  assertRateLimit("LOGIN_IDENTIFIER", keys.identifier);
  assertRateLimit("LOGIN_IP", keys.ip);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Gagal login: catat di ketiga limiter (hanya-kegagalan), padding waktu, lalu 401 seragam. */
async function rejectCredentials(keys: LimiterKeys, startedAt: number): Promise<never> {
  getLimiter("LOGIN_PAIR").recordFailure(keys.pair);
  getLimiter("LOGIN_IDENTIFIER").recordFailure(keys.identifier);
  getLimiter("LOGIN_IP").recordFailure(keys.ip);
  const elapsed = performance.now() - startedAt;
  if (elapsed < LOGIN_FAILURE_MIN_MS) await sleep(LOGIN_FAILURE_MIN_MS - elapsed);
  throw unauthorized("INVALID_CREDENTIALS", INVALID_CREDENTIALS_MESSAGE);
}

/** Aturan input murni yang tidak membutuhkan DB (NISN => pasti STUDENT). */
function assertLoginInput(identifier: IdentifierKind, body: LoginBody): void {
  if (identifier.kind === "INVALID") {
    throw badRequest("VALIDATION_FAILED", "Masukkan NISN 10 digit atau email yang valid.", [
      { path: "body.identifier", code: "custom", message: "Masukkan NISN 10 digit atau email yang valid." },
    ]);
  }
  if (identifier.kind === "NISN" && isMobilePlatform(body.platform) && !body.deviceId) {
    throw badRequest("DEVICE_ID_REQUIRED", "deviceId wajib dikirim untuk login siswa dari aplikasi mobile.");
  }
  if (body.expoPushToken && !isMobilePlatform(body.platform)) {
    throw unprocessable("PUSH_TOKEN_WEB_SESSION", "Token push hanya dapat dipasang pada sesi aplikasi mobile (ANDROID/IOS).");
  }
}

function assertAccountUsable(account: LoginAccount, now: Date): void {
  const eligibility = checkLoginEligibility({
    isActive: account.isActive,
    role: account.role,
    schoolActive: account.schoolActive,
    studentStatus: account.student?.status ?? null,
  });
  if (!eligibility.ok) {
    throw forbidden("ACCOUNT_INACTIVE", ACCOUNT_INACTIVE_MESSAGES[eligibility.reason], { reason: eligibility.reason });
  }
  const expiry = account.tempPasswordExpiresAt;
  if (account.mustChangePassword && expiry !== null && expiry.getTime() < now.getTime()) {
    throw forbidden("TEMP_PASSWORD_EXPIRED", "Kata sandi sementara sudah kedaluwarsa. Minta reset kata sandi ke admin.");
  }
}

async function bindStudentDevice(tx: Tx, account: LoginAccount, body: LoginBody, now: Date): Promise<void> {
  if (!account.student) return;
  const decision = decideDeviceBinding(account.student, body.platform, body.deviceId ?? null);
  if (!decision.bind) return;
  await tx.student.updateMany({
    where: {
      id: account.student.id,
      schoolId: account.student.schoolId,
      OR: [{ boundDeviceId: null }, { boundDeviceId: { not: decision.deviceId } }],
    },
    data: { boundDeviceId: decision.deviceId, deviceBoundAt: now },
  });
}

/** Satu transaksi: kunci user -> ikat perangkat siswa (Student) -> lastLoginAt (User) -> sesi. */
function createLoginSession(account: LoginAccount, body: LoginBody, ctx: ActionContext): Promise<IssuedSession> {
  const input = {
    userId: account.userId,
    role: account.role,
    platform: body.platform,
    deviceId: body.deviceId ?? null,
    deviceName: body.deviceName ?? null,
    expoPushToken: body.expoPushToken ?? null,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    now: ctx.now,
  };
  return retryOnUniqueConflict(() =>
    withTx(async (tx) => {
      await lockUserSessions(tx, account.userId);
      await bindStudentDevice(tx, account, body, ctx.now);
      await tx.user.update({ where: { id: account.userId }, data: { lastLoginAt: ctx.now }, select: { id: true } });
      return openSession(tx, input);
    }),
  );
}

export async function login(body: LoginBody, ctx: ActionContext): Promise<AuthTokens> {
  const startedAt = performance.now();
  const identifier = classifyIdentifier(body.identifier);
  assertLoginInput(identifier, body);
  const keys = limiterKeysOf(ctx.ip, identifier);
  assertNotLocked(keys);
  const account = await findLoginAccount(identifier);
  const passwordOk = await verifyPassword(body.password, account?.passwordHash ?? null);
  if (!account || !passwordOk) return rejectCredentials(keys, startedAt);
  getLimiter("LOGIN_PAIR").reset(keys.pair);
  assertAccountUsable(account, ctx.now);
  const session = await createLoginSession(account, body, ctx);
  const access = await signAccessToken({ sub: account.userId, sid: session.sessionId }, ctx.now);
  return toAuthTokens(access, session, { ...account, id: account.userId });
}
