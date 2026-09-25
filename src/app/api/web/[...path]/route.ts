import { NextRequest, NextResponse } from "next/server";
import { operations } from "@/lib/frontend/catalog";
import { boundedBody, sameOrigin } from "@/lib/frontend/web-transport";

export const runtime = "nodejs";
const ACCESS = "studenthub_access";
const REFRESH = "studenthub_refresh";
const cookieOptions = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/api/web" };
function failure(message: string, status: number) {
  return NextResponse.json({ success: false, data: null, error: { code: "WEB_SESSION", message }, meta: null }, { status });
}
function allowed(path: string, method: string) {
  return operations.some(op => op.method === method && new RegExp(`^${op.path.replace(/\{[^}]+\}/g, "[^/]+")}$`).test(path));
}
function setTokens(response: NextResponse, data: Record<string, unknown>) {
  response.cookies.set(ACCESS, String(data.accessToken), { ...cookieOptions, expires: new Date(String(data.accessTokenExpiresAt)) });
  response.cookies.set(REFRESH, String(data.refreshToken), { ...cookieOptions, expires: new Date(String(data.refreshTokenExpiresAt)) });
}
function clearTokens(response: NextResponse): NextResponse {
  response.cookies.set(ACCESS, "", { ...cookieOptions, maxAge: 0 });
  response.cookies.set(REFRESH, "", { ...cookieOptions, maxAge: 0 });
  return response;
}
const LOGOUT_PATHS = ["/auth/logout", "/auth/logout-all"];
const NO_STORE = { "Cache-Control": "private, no-store" };
const OK = { success: true, data: null, error: null, meta: null };
function upstreamUrl(request: NextRequest, path: string, search = "") {
  const port = (process.env.PORT ?? request.nextUrl.port) || "3030";
  return `http://127.0.0.1:${port}/api/v1${path}${search}`;
}
function withHeader(headers: Headers, name: string, value: string): Headers {
  const next = new Headers(headers);
  next.set(name, value);
  return next;
}
/** Access token tidak ada/ditolak: tukar refresh token lalu cabut sesi itu di server (tanpa refresh token: tak ada yang dicabut). */
async function revokeWithRefresh(request: NextRequest, path: string, headers: Headers): Promise<void> {
  const refreshToken = request.cookies.get(REFRESH)?.value;
  if (!refreshToken) return;
  const refreshed = await fetch(upstreamUrl(request, "/auth/refresh"), { method: "POST", headers: withHeader(headers, "Content-Type", "application/json"), body: JSON.stringify({ refreshToken }), cache: "no-store", redirect: "error" });
  const access = refreshed.ok ? ((await refreshed.json()) as { data?: { accessToken?: string } }).data?.accessToken : undefined;
  if (access) await fetch(upstreamUrl(request, path), { method: "POST", headers: withHeader(headers, "Authorization", `Bearer ${access}`), cache: "no-store", redirect: "error" });
}
/** Keluar: cabut sesi di server (lewat refresh token bila access token tidak ada/ditolak), lalu SELALU hapus cookie. */
async function logout(request: NextRequest, path: string, headers: Headers): Promise<NextResponse> {
  const access = request.cookies.get(ACCESS)?.value;
  try {
    const upstream = access ? await fetch(upstreamUrl(request, path), { method: "POST", headers: withHeader(headers, "Authorization", `Bearer ${access}`), cache: "no-store", redirect: "error" }) : null;
    if (upstream && upstream.status !== 401) return clearTokens(NextResponse.json(await upstream.json().catch(() => OK), { status: upstream.status, headers: NO_STORE }));
    await revokeWithRefresh(request, path, headers);
    return clearTokens(NextResponse.json(OK, { headers: NO_STORE }));
  } catch { return clearTokens(failure("Layanan sedang tidak tersedia. Sesi di perangkat ini sudah diakhiri.", 502)); }
}
function forwardedHeaders(request: NextRequest): Headers {
  const headers = new Headers();
  if (request.headers.has("content-type")) headers.set("Content-Type", request.headers.get("content-type")!);
  if (request.headers.has("x-real-ip")) headers.set("X-Real-IP", request.headers.get("x-real-ip")!);
  // Absensi dari browser HP diputuskan server berdasarkan user-agent perangkat asli.
  if (request.headers.has("user-agent")) headers.set("User-Agent", request.headers.get("user-agent")!);
  return headers;
}
async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const segments = (await context.params).path;
  if (segments.some(s => !/^[a-zA-Z0-9._:-]+$/.test(s) || s === "." || s === "..")) return failure("Alamat tidak valid.", 400);
  const path = `/${segments.join("/")}`;
  if (!allowed(path, request.method)) return failure("Halaman tidak ditemukan.", 404);
  if (request.method !== "GET" && !sameOrigin(request)) return failure("Asal permintaan tidak valid. Muat ulang halaman.", 403);
  const headers = forwardedHeaders(request);
  if (LOGOUT_PATHS.includes(path)) return logout(request, path, headers);
  const isPublic = path === "/auth/login" || path === "/auth/refresh";
  const access = request.cookies.get(ACCESS)?.value;
  if (!isPublic && access) headers.set("Authorization", `Bearer ${access}`);
  if (!isPublic && !access) return failure("Sesi berakhir. Silakan masuk kembali.", 401);
  let body: BodyInit | undefined;
  try { body = request.method === "GET" ? undefined : await boundedBody(request); }
  catch { return failure("Berkas terlalu besar atau tidak dapat dibaca. Maksimal 10 MB.", 413); }
  if (path === "/auth/refresh") {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify({ refreshToken: request.cookies.get(REFRESH)?.value ?? "" });
  }
  try {
    const upstream = await fetch(upstreamUrl(request, path, request.nextUrl.search), { method: request.method, headers, body, cache: "no-store", redirect: "error" });
    if (!upstream.headers.get("content-type")?.includes("application/json")) {
      const result = new NextResponse(upstream.body, { status: upstream.status });
      for (const key of ["content-type", "content-disposition"]) if (upstream.headers.has(key)) result.headers.set(key, upstream.headers.get(key)!);
      result.headers.set("Cache-Control", "private, no-store");
      return result;
    }
    const payload = await upstream.json();
    const tokens = isPublic && upstream.ok ? { ...payload.data } : null;
    if (tokens) { delete payload.data.accessToken; delete payload.data.refreshToken; }
    const response = NextResponse.json(payload, { status: upstream.status, headers: NO_STORE });
    if (tokens) setTokens(response, tokens);
    return response;
  } catch { return failure("Layanan sedang tidak tersedia. Silakan coba lagi.", 502); }
}
export { proxy as GET, proxy as POST, proxy as PATCH, proxy as PUT, proxy as DELETE };
