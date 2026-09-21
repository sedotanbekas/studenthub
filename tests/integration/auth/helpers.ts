/**
 * Pembantu integration test domain auth: login lewat route asli, IP & deviceId unik per test.
 */
import { randomBytes, randomInt } from "node:crypto";
import { POST as loginRoute } from "@/app/api/v1/auth/login/route";
import { POST as refreshRoute } from "@/app/api/v1/auth/refresh/route";
import { GET as meRoute } from "@/app/api/v1/auth/me/route";
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
