/**
 * Pembantu integration test domain auth: login lewat route asli, IP & deviceId unik per test.
 */
import { randomBytes, randomInt } from "node:crypto";
import { POST as loginRoute } from "@/app/api/v1/auth/login/route";
import { POST as refreshRoute } from "@/app/api/v1/auth/refresh/route";
import { GET as meRoute } from "@/app/api/v1/auth/me/route";
import { prisma, type Tx } from "../helpers/db";
import { DEFAULT_TEST_PASSWORD } from "../helpers/factories";
import { callRoute, type Envelope, type RouteResult } from "../helpers/request";

export interface TokensBody {
  readonly accessToken: string;
  readonly accessTokenExpiresAt: string;
  readonly refreshToken: string;
  readonly refreshTokenExpiresAt: string;
  readonly sessionId: string;
  readonly user: { id: string; name: string; role: string; schoolId: string | null; sponsorId: string | null };
  readonly mustChangePassword: boolean;
}

export type ApiResult<T> = RouteResult<Envelope<T>>;

/** IPv4 privat acak agar key limiter tiap test terpisah. */
export function uniqIp(): string {
  return `10.${randomInt(0, 256)}.${randomInt(0, 256)}.${randomInt(1, 255)}`;
}

export function uniqDeviceId(): string {
  return `dev-${randomBytes(6).toString("hex")}`;
}

export function uniqPushToken(): string {
  return `ExponentPushToken[${randomBytes(12).toString("hex")}]`;
}

export interface LoginOptions {
  readonly password?: string;
  readonly platform?: "ANDROID" | "IOS" | "WEB";
  readonly deviceId?: string;
  readonly deviceName?: string;
  readonly expoPushToken?: string;
  readonly ip?: string;
  readonly userAgent?: string;
  readonly totpCode?: string;
}

export function loginRaw(json: unknown, headers: Record<string, string> = {}): Promise<ApiResult<TokensBody>> {
  return callRoute<Envelope<TokensBody>>(loginRoute, { method: "POST", url: "/api/v1/auth/login", json, headers });
}

export function login(identifier: string, options: LoginOptions = {}): Promise<ApiResult<TokensBody>> {
  const platform = options.platform ?? "WEB";
  const deviceId = options.deviceId ?? (platform === "WEB" ? undefined : uniqDeviceId());
  const headers: Record<string, string> = { "x-real-ip": options.ip ?? uniqIp() };
  if (options.userAgent) headers["user-agent"] = options.userAgent;
  return loginRaw(
    {
      identifier,
      password: options.password ?? DEFAULT_TEST_PASSWORD,
      platform,
      ...(deviceId ? { deviceId } : {}),
      ...(options.deviceName ? { deviceName: options.deviceName } : {}),
      ...(options.expoPushToken ? { expoPushToken: options.expoPushToken } : {}),
      ...(options.totpCode ? { totpCode: options.totpCode } : {}),
    },
    headers,
  );
}

/** Login yang harus berhasil; mengembalikan data token. */
export async function loginOk(identifier: string, options: LoginOptions = {}): Promise<TokensBody> {
  const res = await login(identifier, options);
  if (res.status !== 200 || !res.body?.data) {
    throw new Error(`login ${identifier} gagal: ${res.status} ${JSON.stringify(res.body?.error)}`);
  }
  return res.body.data;
}

export function refresh(refreshToken: string, ip: string = uniqIp()): Promise<ApiResult<TokensBody>> {
  return callRoute<Envelope<TokensBody>>(refreshRoute, {
    method: "POST",
    url: "/api/v1/auth/refresh",
    json: { refreshToken },
    headers: { "x-real-ip": ip },
  });
}

export interface MeBody {
  readonly user: { id: string; name: string; email: string | null; role: string; mustChangePassword: boolean; lastLoginAt: string | null };
  readonly school: { id: string; name: string; timezone: string } | null;
  readonly student: { id: string; nisn: string; nis: string; status: string; className: string | null } | null;
  readonly sponsor: { id: string; companyName: string; status: string } | null;
  readonly permissions: string[];
}

export function me(accessToken: string): Promise<ApiResult<MeBody>> {
  return callRoute<Envelope<MeBody>>(meRoute, { method: "GET", url: "/api/v1/auth/me", bearer: accessToken });
}

// ----------------------------------------------------------------------------- balapan deterministik

export interface HeldTransaction {
  /** Selesai setelah `setup` berjalan (kunci/tulisan pemegang sudah aktif, belum commit). */
  readonly ready: Promise<void>;
  /** Jalankan `beforeCommit` lalu commit; menunggu sampai transaksi selesai. */
  readonly commit: () => Promise<void>;
}

/**
 * Transaksi "pihak lain" yang ditahan terbuka: `setup` mengambil kunci/menulis data (belum commit),
 * lalu transaksi menunggu `commit()`. Dipakai untuk menyisipkan tulisan bersamaan di tengah alur lain.
 */
export function holdTransaction(setup: (tx: Tx) => Promise<void>, beforeCommit?: (tx: Tx) => Promise<void>): HeldTransaction {
  let markReady: () => void = () => undefined;
  let release: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const done = prisma.$transaction(
    async (tx) => {
      await setup(tx as Tx);
      markReady();
      await released;
      if (beforeCommit) await beforeCommit(tx as Tx);
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
  done.catch(() => markReady());
  return {
    ready,
    commit: async () => {
      release();
      await done;
    },
  };
}

const POLL_MS = 10;
const BLOCK_WAIT_TIMEOUT_MS = 10_000;

/** Ada statement koneksi LAIN yang sedang berjalan (bukan Sleep) dan memuat salah satu potongan SQL. */
async function hasRunningStatement(fragments: readonly string[]): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ info: string | null }>>`
    SELECT INFO AS info FROM information_schema.PROCESSLIST
    WHERE ID <> CONNECTION_ID() AND COMMAND <> 'Sleep' AND INFO IS NOT NULL`;
  return rows.some((row) => fragments.some((fragment) => row.info?.includes(fragment)));
}

/**
 * Menunggu sampai `pending` tertahan kunci pemegang (statement yang memuat salah satu `fragments`
 * sedang menunggu) — atau `pending` sudah selesai duluan (implementasi yang tidak menunggu kunci).
 * PROCESSLIST hanya memperlihatkan koneksi user DB yang sama, cukup untuk test (tanpa hak PROCESS).
 */
export async function waitUntilBlocked(pending: Promise<unknown>, fragments: readonly string[]): Promise<"blocked" | "settled"> {
  let settled = false;
  const markSettled = (): void => {
    settled = true;
  };
  pending.then(markSettled, markSettled);
  const deadline = Date.now() + BLOCK_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (settled) return "settled";
    if (await hasRunningStatement(fragments)) return "blocked";
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(`Batas waktu menunggu statement tertahan: ${fragments.join(" | ")}`);
}

/** Potongan SQL: kunci aplikasi (lockKey) dan UPDATE baris User. */
export const APP_LOCK_SQL = "INSERT INTO `AppLock`";
export const USER_UPDATE_SQL = "UPDATE `User` SET";
