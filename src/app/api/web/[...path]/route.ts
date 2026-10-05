import { NextRequest, NextResponse } from "next/server";
import { SESSION_ABSOLUTE_TTL_MS } from "@/lib/auth/constants";
import { operations } from "@/lib/frontend/catalog";
import { SESSION_HINT } from "@/lib/frontend/session-hint";
import { boundedBody, sameOrigin } from "@/lib/frontend/web-transport";

export const runtime = "nodejs";
const ACCESS = "studenthub_access";
const REFRESH = "studenthub_refresh";
const cookieOptions = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/api/web" };
/** "Ingat perangkat ini" (super admin, 30 hari): hanya dikirim ke login; bertahan setelah keluar. */
const TRUSTED = "studenthub_trusted";
const trustedOptions = { ...cookieOptions, path: "/api/web/auth/login" };
/** Penanda sesi (tanpa rahasia) terbaca server di /hub: src/lib/frontend/session-hint.ts. */
const hintOptions = { ...cookieOptions, path: "/" };
/**
 * "Masuk sebagai" (2026-10-05): refresh token super admin disimpan di sini selama browser memakai sesi akun lain;
 * dipulihkan saat Akhiri, saat sesi itu kedaluwarsa (refresh ditolak), dan dicabut bersama saat Keluar.
 */
const STASH = "studenthub_impersonator";
const IMPERSONATE_PATH = /^\/platform\/users\/[^/]+\/impersonate$/;
const END_IMPERSONATION_PATH = "/auth/impersonation/end";
/** Umur penanda untuk sesi yang kedaluwarsa refresh token-nya tidak diketahui (= umur sesi web). */
const HINT_MAX_AGE_S = Math.floor(SESSION_ABSOLUTE_TTL_MS.WEB / 1000);
function failure(message: string, status: number) {
  return NextResponse.json({ success: false, data: null, error: { code: "WEB_SESSION", message }, meta: null }, { status });
}
function allowed(path: string, method: string) {
  return operations.some(op => op.method === method && new RegExp(`^${op.path.replace(/\{[^}]+\}/g, "[^/]+")}$`).test(path));
}
function setTokens(response: NextResponse, data: Record<string, unknown>) {
  const refreshExpires = new Date(String(data.refreshTokenExpiresAt));
  response.cookies.set(ACCESS, String(data.accessToken), { ...cookieOptions, expires: new Date(String(data.accessTokenExpiresAt)) });
  response.cookies.set(REFRESH, String(data.refreshToken), { ...cookieOptions, expires: refreshExpires });
  response.cookies.set(SESSION_HINT, "1", { ...hintOptions, expires: refreshExpires });
}
function setTrustedDevice(response: NextResponse, data: Record<string, unknown>) {
  const trusted = data.trustedDevice as { token?: unknown; expiresAt?: unknown } | undefined;
  if (typeof trusted?.token === "string" && typeof trusted.expiresAt === "string") response.cookies.set(TRUSTED, trusted.token, { ...trustedOptions, expires: new Date(trusted.expiresAt) });
}
/** Token perangkat tepercaya dari cookie disisipkan ke body login (JS halaman tidak pernah melihatnya). */
function withTrustedDevice(request: NextRequest, body: BodyInit | undefined): BodyInit | undefined {
  const token = request.cookies.get(TRUSTED)?.value;
  if (!token || !(body instanceof ArrayBuffer)) return body;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(body)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? JSON.stringify({ ...parsed, trustedDeviceToken: token }) : body;
  } catch { return body; }
}
function clearHint(response: NextResponse): NextResponse {
  response.cookies.set(SESSION_HINT, "", { ...hintOptions, maxAge: 0 });
  return response;
}
function clearTokens(response: NextResponse): NextResponse {
  response.cookies.set(ACCESS, "", { ...cookieOptions, maxAge: 0 });
  response.cookies.set(REFRESH, "", { ...cookieOptions, maxAge: 0 });
  return clearHint(response);
}
/**
 * Status sesi TANPA memanggil backend, selalu 200: halaman masuk (dirender server tanpa penanda) memeriksa
 * sesi lama tanpa mencatat galat 401/400 di konsol. Sekaligus menyelaraskan penanda dengan cookie token.
 */
function sessionStatus(request: NextRequest): NextResponse {
  const active = Boolean(request.cookies.get(ACCESS)?.value || request.cookies.get(REFRESH)?.value);
  const response = NextResponse.json({ success: true, data: { active }, error: null, meta: null }, { headers: NO_STORE });
  if (active && request.cookies.get(SESSION_HINT)?.value !== "1") response.cookies.set(SESSION_HINT, "1", { ...hintOptions, maxAge: HINT_MAX_AGE_S });
  if (!active && request.cookies.has(SESSION_HINT)) clearHint(response);
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
async function revokeWithRefresh(request: NextRequest, path: string, headers: Headers, refreshToken = request.cookies.get(REFRESH)?.value): Promise<void> {
  if (!refreshToken) return;
  const refreshed = await fetch(upstreamUrl(request, "/auth/refresh"), { method: "POST", headers: withHeader(headers, "Content-Type", "application/json"), body: JSON.stringify({ refreshToken }), cache: "no-store", redirect: "error" });
  const access = refreshed.ok ? ((await refreshed.json()) as { data?: { accessToken?: string } }).data?.accessToken : undefined;
  if (access) await fetch(upstreamUrl(request, path), { method: "POST", headers: withHeader(headers, "Authorization", `Bearer ${access}`), cache: "no-store", redirect: "error" });
}
/** POST ke backend dengan access token cookie; null bila tidak ada access token. */
function postWithAccess(request: NextRequest, path: string, headers: Headers): Promise<Response> | null {
  const access = request.cookies.get(ACCESS)?.value;
  return access ? fetch(upstreamUrl(request, path), { method: "POST", headers: withHeader(headers, "Authorization", `Bearer ${access}`), cache: "no-store", redirect: "error" }) : null;
}
function clearStash(request: NextRequest, response: NextResponse): NextResponse {
  if (request.cookies.has(STASH)) response.cookies.set(STASH, "", { ...cookieOptions, maxAge: 0 });
  return response;
}
/** Kembali ke sesi super admin: refresh token tersimpan dipasang lagi; access token dibuang (klien menyegarkan sendiri). */
function restoreStash(request: NextRequest, response: NextResponse, stash: string): NextResponse {
  response.cookies.set(REFRESH, stash, { ...cookieOptions, maxAge: HINT_MAX_AGE_S });
  response.cookies.set(ACCESS, "", { ...cookieOptions, maxAge: 0 });
  response.cookies.set(SESSION_HINT, "1", { ...hintOptions, maxAge: HINT_MAX_AGE_S });
  return clearStash(request, response);
}
/** Keluar: cabut sesi di server (lewat refresh token bila access token tidak ada/ditolak), lalu SELALU hapus cookie. */
async function logout(request: NextRequest, path: string, headers: Headers): Promise<NextResponse> {
  const stash = request.cookies.get(STASH)?.value;
  try {
    const upstream = await postWithAccess(request, path, headers);
    let response: NextResponse;
    if (upstream && upstream.status !== 401) {
      response = NextResponse.json(await upstream.json().catch(() => OK), { status: upstream.status, headers: NO_STORE });
    } else {
      await revokeWithRefresh(request, path, headers);
      response = NextResponse.json(OK, { headers: NO_STORE });
    }
    // Keluar saat "Masuk sebagai": sesi super admin yang tersimpan ikut diakhiri.
    if (stash) await revokeWithRefresh(request, "/auth/logout", headers, stash);
    return clearStash(request, clearTokens(response));
  } catch { return clearStash(request, clearTokens(failure("Layanan sedang tidak tersedia. Sesi di perangkat ini sudah diakhiri.", 502))); }
}
/** Akhiri "Masuk sebagai": cabut sesi akun yang dibuka (lewat refresh bila access habis), lalu pulihkan sesi super admin. */
async function endImpersonation(request: NextRequest, headers: Headers): Promise<NextResponse> {
  const stash = request.cookies.get(STASH)?.value;
  let upstream: Response | null = null;
  try {
    upstream = await postWithAccess(request, END_IMPERSONATION_PATH, headers);
    if (!upstream || upstream.status === 401) await revokeWithRefresh(request, END_IMPERSONATION_PATH, headers);
  } catch { if (!stash) return failure("Layanan sedang tidak tersedia. Silakan coba lagi.", 502); }
  // 409 NOT_IMPERSONATING: sesi ini sesi biasa -> stash (sisa lama) TIDAK dipulihkan.
  if (upstream?.status === 409) return NextResponse.json(await upstream.json().catch(() => OK), { status: 409, headers: NO_STORE });
  if (stash) return restoreSuperAdmin(request, headers, stash);
  return upstream ? NextResponse.json(await upstream.json().catch(() => OK), { status: upstream.status, headers: NO_STORE }) : NextResponse.json(OK, { headers: NO_STORE });
}
/** Tukar refresh token super admin tersimpan agar sesi langsung siap; gagal -> pasang refresh token apa adanya (klien menyegarkan). */
async function restoreSuperAdmin(request: NextRequest, headers: Headers, stash: string): Promise<NextResponse> {
  const response = NextResponse.json({ ...OK, data: { ended: true } }, { headers: NO_STORE });
  try {
    const refreshed = await fetch(upstreamUrl(request, "/auth/refresh"), { method: "POST", headers: withHeader(headers, "Content-Type", "application/json"), body: JSON.stringify({ refreshToken: stash }), cache: "no-store", redirect: "error" });
    // 409 REFRESH_RACE: tab lain baru saja menukar token yang sama dan sudah memasang cookie -> jangan ditimpa token basi.
    if (refreshed.status === 409) return response;
    const data = refreshed.ok ? ((await refreshed.json()) as { data?: Record<string, unknown> }).data : undefined;
    if (typeof data?.accessToken === "string") { setTokens(response, data); return clearStash(request, response); }
  } catch { /* jaringan ke backend gagal: pulihkan refresh token apa adanya di bawah */ }
  return restoreStash(request, response, stash);
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
  if (path === "/session" && request.method === "GET") return sessionStatus(request);
  if (!allowed(path, request.method)) return failure("Halaman tidak ditemukan.", 404);
  if (request.method !== "GET" && !sameOrigin(request)) return failure("Asal permintaan tidak valid. Muat ulang halaman.", 403);
  const headers = forwardedHeaders(request);
  if (LOGOUT_PATHS.includes(path)) return logout(request, path, headers);
  if (path === END_IMPERSONATION_PATH) return endImpersonation(request, headers);
  const isPublic = path === "/auth/login" || path === "/auth/refresh";
  const access = request.cookies.get(ACCESS)?.value;
  if (!isPublic && access) headers.set("Authorization", `Bearer ${access}`);
  if (!isPublic && !access) return failure("Sesi berakhir. Silakan masuk kembali.", 401);
  let body: BodyInit | undefined;
  try { body = request.method === "GET" ? undefined : await boundedBody(request); }
  catch { return failure("Berkas terlalu besar atau tidak dapat dibaca. Maksimal 10 MB.", 413); }
  if (path === "/auth/login") body = withTrustedDevice(request, body);
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
      // Berkas privat bisa dibuka sebagai dokumen di tab baru: jangan pernah di-sniff/dijalankan di origin aplikasi.
      result.headers.set("X-Content-Type-Options", "nosniff");
      result.headers.set("Content-Security-Policy", "default-src none; sandbox");
      return result;
    }
    // Login baru saat stash tertinggal (mis. tab ditutup saat "Masuk sebagai"): cabut sesi super admin yang tersimpan.
    const stash = request.cookies.get(STASH)?.value;
    if (path === "/auth/login" && upstream.ok && stash) await revokeWithRefresh(request, "/auth/logout", headers, stash).catch(() => undefined);
    return jsonResponse(request, path, upstream.status, await upstream.json());
  } catch { return failure("Layanan sedang tidak tersedia. Silakan coba lagi.", 502); }
}
/**
 * Respons JSON backend. Token dari login/refresh/"Masuk sebagai" dipindah ke cookie (tidak pernah terbaca JS halaman).
 * Masuk sebagai: refresh token super admin saat ini disimpan di STASH; login baru membuang STASH lama.
 */
function jsonResponse(request: NextRequest, path: string, status: number, payload: { data?: Record<string, unknown> | null }): NextResponse {
  const impersonating = IMPERSONATE_PATH.test(path);
  const issuesTokens = path === "/auth/login" || path === "/auth/refresh" || impersonating;
  const tokens = issuesTokens && status >= 200 && status < 300 && payload.data ? { ...payload.data } : null;
  if (tokens && payload.data) { delete payload.data.accessToken; delete payload.data.refreshToken; delete payload.data.trustedDevice; }
  const response = NextResponse.json(payload, { status, headers: NO_STORE });
  if (tokens) {
    const current = request.cookies.get(REFRESH)?.value;
    if (impersonating && current) response.cookies.set(STASH, current, { ...cookieOptions, maxAge: HINT_MAX_AGE_S });
    if (path === "/auth/login") clearStash(request, response);
    setTokens(response, tokens);
    setTrustedDevice(response, tokens);
  }
  // Kecuali 409 REFRESH_RACE: tab lain baru saja memutar token (sesi masih hidup; N1).
  if (path === "/auth/refresh" && status >= 400 && status < 500 && status !== 409) refreshRejected(request, response);
  return response;
}
/**
 * Refresh token ditolak. Sesi "Masuk sebagai" berakhir (30 menit/dicabut): pulihkan sesi super admin + header agar klien
 * memuat ulang sebagai super admin. Selain itu sesi sudah berakhir: halaman berikutnya langsung dirender sebagai halaman masuk.
 */
function refreshRejected(request: NextRequest, response: NextResponse): void {
  const stash = request.cookies.get(STASH)?.value;
  if (!stash) { clearHint(response); return; }
  restoreStash(request, response, stash);
  response.headers.set("X-Impersonation-Ended", "1");
}
export { proxy as GET, proxy as POST, proxy as PATCH, proxy as PUT, proxy as DELETE };
