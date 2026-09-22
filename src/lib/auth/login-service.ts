import type { StudentStatus, UserRole } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { rateLimitKeyForIp } from "@/lib/http/client-ip";
import { badRequest, forbidden, isAppError, unauthorized, unprocessable } from "@/lib/http/errors";
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
import { lockUserSessions, openSession, retryOnUniqueConflict, type NewSessionInput } from "./session-service";
import { checkLoginTotpCode, consumeTotpStep, totpInvalid } from "./totp-service";

/**
 * POST /auth/login. Urutan: validasi input murni -> limiter: cek kunci + pesan slot di 3 limiter (sebelum
 * DB) -> cari akun -> tepat satu bcrypt (dummy bila tidak ada) -> gagal: slot tetap terpakai + padding
 * >= 300 ms + 401 seragam -> faktor kedua (super admin ber-TOTP) -> benar: slot dikembalikan -> kelayakan
 * akun -> satu transaksi pembuatan sesi (kunci user, baca ulang kredensial & kelayakan, CAS langkah TOTP,
 * compare-and-set lastLoginAt) -> access token.
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
  readonly totpEnabledAt: Date | null;
  readonly totpSecretEnc: string | null;
  readonly totpLastUsedStep: number | null;
  readonly schoolActive: boolean | null;
  readonly student: { readonly id: string; readonly schoolId: string; readonly status: StudentStatus; readonly boundDeviceId: string | null } | null;
}

export interface LimiterKeys {
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
  totpEnabledAt: true,
  totpSecretEnc: true,
  totpLastUsedStep: true,
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
  totpEnabledAt: Date | null;
  totpSecretEnc: string | null;
  totpLastUsedStep: number | null;
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
    totpEnabledAt: user.totpEnabledAt,
    totpSecretEnc: user.totpSecretEnc,
    totpLastUsedStep: user.totpLastUsedStep,
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

/** Key ketiga limiter login untuk satu permintaan (pola di src/lib/http/rate-limits.ts). */
export function loginLimiterKeys(ip: string | null, identifier: IdentifierKind): LimiterKeys {
  const ipKey = rateLimitKeyForIp(ip);
  const id = limiterIdentifier(identifier) ?? "invalid";
  return { pair: `login:pair:${ipKey}::${id}`, identifier: `login:id:${id}`, ip: `login:ip:${ipKey}` };
}

/**
 * Cek kunci lalu pesan SATU slot di ketiga limiter SEBELUM lookup DB/bcrypt. Cek + pesan berjalan sinkron
 * (tanpa await di antaranya), jadi burst paralel tidak bisa melampaui batas: setelah slot ke-`limit`
 * terpakai, permintaan berikutnya langsung 429. Slot permintaan yang gagal tetap terpakai.
 */
function reserveAttempt(keys: LimiterKeys): void {
  assertRateLimit("LOGIN_PAIR", keys.pair);
  assertRateLimit("LOGIN_IDENTIFIER", keys.identifier);
  assertRateLimit("LOGIN_IP", keys.ip);
  getLimiter("LOGIN_PAIR").recordFailure(keys.pair);
  getLimiter("LOGIN_IDENTIFIER").recordFailure(keys.identifier);
  getLimiter("LOGIN_IP").recordFailure(keys.ip);
}

/**
 * Kata sandi benar: slot identifier & IP dikembalikan, pasangan IP+identifier direset. Kunci yang
 * terpasang karena slot ini tepat mencapai batas tetap berlaku (release tidak pernah membuka kunci).
 */
function refundAttempt(keys: LimiterKeys): void {
  getLimiter("LOGIN_PAIR").reset(keys.pair);
  getLimiter("LOGIN_IDENTIFIER").release(keys.identifier);
  getLimiter("LOGIN_IP").release(keys.ip);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const invalidCredentials = () => unauthorized("INVALID_CREDENTIALS", INVALID_CREDENTIALS_MESSAGE);

/** Padding waktu respons gagal ke minimal LOGIN_FAILURE_MIN_MS sejak permintaan dimulai. */
async function padFailure(startedAt: number): Promise<void> {
  const elapsed = performance.now() - startedAt;
  if (elapsed < LOGIN_FAILURE_MIN_MS) await sleep(LOGIN_FAILURE_MIN_MS - elapsed);
}

/** Gagal login (slot limiter sudah dipesan): padding waktu, lalu 401 seragam. */
async function rejectCredentials(startedAt: number): Promise<never> {
  await padFailure(startedAt);
  throw invalidCredentials();
}

/**
 * Faktor kedua super admin ber-TOTP aktif (setelah kata sandi benar). Tanpa kode -> slot login dikembalikan
 * (belum ada tebakan) lalu 401 TOTP_REQUIRED; kode salah/replay -> slot tetap terpakai + limiter TOTP_VERIFY
 * lalu 401 TOTP_INVALID. Keduanya dipadatkan waktunya seperti kegagalan kata sandi. Mengembalikan langkah
 * TOTP yang dikonsumsi di transaksi login (null = akun tanpa TOTP).
 */
async function checkSecondFactor(account: LoginAccount, body: LoginBody, keys: LimiterKeys, ctx: ActionContext, startedAt: number): Promise<number | null> {
  if (account.role !== "SUPER_ADMIN" || account.totpEnabledAt === null) return null;
  if (!body.totpCode) {
    refundAttempt(keys);
    await padFailure(startedAt);
    throw unauthorized("TOTP_REQUIRED", "Masukkan kode verifikasi (TOTP) dari aplikasi autentikator.");
  }
  const step = checkLoginTotpCode(account, body.totpCode, ctx.now);
  if (step === null) {
    await padFailure(startedAt);
    throw totpInvalid();
  }
  return step;
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

/** Baca ulang akun (user + siswa + sekolah) di dalam transaksi login, setelah kunci user dipegang. */
async function reloadAccount(tx: Tx, userId: string): Promise<LoginAccount | null> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { ...USER_SELECT, student: { select: { id: true, schoolId: true, status: true, boundDeviceId: true } } },
  });
  return user ? toAccount(user, user.student) : null;
}

/**
 * Di bawah kunci user, kredensial & kelayakan dibaca ulang (bcrypt tadi berjalan di luar transaksi):
 * hash berbeda dari yang diverifikasi (kata sandi diganti/direset saat login berjalan) -> 401
 * INVALID_CREDENTIALS; akun tidak lagi layak -> 403 yang sama dengan permintaan sesudahnya.
 */
async function recheckAccount(tx: Tx, verified: LoginAccount, now: Date): Promise<LoginAccount> {
  const fresh = await reloadAccount(tx, verified.userId);
  if (!fresh || fresh.passwordHash !== verified.passwordHash) throw invalidCredentials();
  assertAccountUsable(fresh, now);
  return fresh;
}

/**
 * lastLoginAt sebagai compare-and-set pada hash terverifikasi. Penulis kata sandi yang tidak memegang kunci
 * user (mis. reset siswa oleh sekolah) memegang kunci baris User: UPDATE ini menunggunya, lalu 0 baris
 * bila hash berubah -> 401. Sebaliknya penulis itu menunggu login ini commit, lalu mencabut sesinya.
 */
async function touchLastLogin(tx: Tx, account: LoginAccount, now: Date): Promise<void> {
  const touched = await tx.user.updateMany({ where: { id: account.userId, passwordHash: account.passwordHash }, data: { lastLoginAt: now } });
  if (touched.count === 0) throw invalidCredentials();
}

function sessionInput(account: LoginAccount, body: LoginBody, ctx: ActionContext): NewSessionInput {
  return {
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
}

interface LoginResult {
  readonly session: IssuedSession;
  /** Akun hasil baca ulang di dalam transaksi (dipakai untuk respons). */
  readonly account: LoginAccount;
}

/**
 * Satu transaksi: kunci user (PERTAMA) -> baca ulang & periksa ulang akun -> ikat perangkat siswa
 * (Student) -> lastLoginAt CAS (User) -> sesi.
 */
function createLoginSession(verified: LoginAccount, body: LoginBody, ctx: ActionContext, totpStep: number | null): Promise<LoginResult> {
  return retryOnUniqueConflict(() =>
    withTx(async (tx) => {
      await lockUserSessions(tx, verified.userId);
      const account = await recheckAccount(tx, verified, ctx.now);
      if (totpStep !== null) await consumeTotpStep(tx, account.userId, totpStep);
      await bindStudentDevice(tx, account, body, ctx.now);
      await touchLastLogin(tx, account, ctx.now);
      const session = await openSession(tx, sessionInput(account, body, ctx));
      return { session, account };
    }),
  );
}

export async function login(body: LoginBody, ctx: ActionContext): Promise<AuthTokens> {
  const startedAt = performance.now();
  const identifier = classifyIdentifier(body.identifier);
  assertLoginInput(identifier, body);
  const keys = loginLimiterKeys(ctx.ip, identifier);
  reserveAttempt(keys);
  const found = await findLoginAccount(identifier);
  const passwordOk = await verifyPassword(body.password, found?.passwordHash ?? null);
  if (!found || !passwordOk) return rejectCredentials(startedAt);
  const totpStep = await checkSecondFactor(found, body, keys, ctx, startedAt);
  refundAttempt(keys);
  assertAccountUsable(found, ctx.now);
  const { session, account } = await createLoginSession(found, body, ctx, totpStep).catch(async (error: unknown) => {
    // Kode TOTP kalah balapan (dipakai login paralel) -> tetap dipadatkan seperti kegagalan lain.
    if (isAppError(error) && error.code === "TOTP_INVALID") await padFailure(startedAt);
    throw error;
  });
  const access = await signAccessToken({ sub: account.userId, sid: session.sessionId }, ctx.now);
  return toAuthTokens(access, session, { ...account, id: account.userId });
}
