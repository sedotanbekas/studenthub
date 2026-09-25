import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET, POST } from "./route";

const origin = "http://localhost:3030";
function request(path: string, method = "POST", headers: Record<string, string> = {}) {
  return new NextRequest(`${origin}/api/web/${path}`, { method, headers: { origin, ...headers } });
}
const params = (path: string) => ({ params: Promise.resolve({ path: path.split("/") }) });
test("BFF menolak mutasi lintas origin sebelum menyentuh backend", async () => {
  const response = await POST(request("auth/login", "POST", { origin: "https://attacker.example" }), params("auth/login"));
  assert.equal(response.status, 403);
});
test("BFF menolak jalur yang bukan kontrak dan tidak menerima bearer dari browser", async () => {
  assert.equal((await GET(request("internal/jobs/tick", "GET"), params("internal/jobs/tick"))).status, 404);
  assert.equal((await GET(request("auth/me", "GET", { authorization: "Bearer browser-supplied" }), params("auth/me"))).status, 401);
});
test("BFF menyimpan token sebagai cookie HttpOnly dan menghapus token dari JSON login", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ success: true, data: { accessToken: "access-private", refreshToken: "refresh-private", accessTokenExpiresAt: "2030-01-01T00:00:00Z", refreshTokenExpiresAt: "2030-02-01T00:00:00Z", user: { name: "Admin" } } }));
  const response = await POST(request("auth/login"), params("auth/login"));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data.accessToken, undefined);
  assert.equal(body.data.refreshToken, undefined);
  assert.equal(body.data.user.name, "Admin");
  const cookies = response.headers.getSetCookie();
  assert.equal(cookies.length, 2);
  assert.ok(cookies.every(cookie => cookie.includes("HttpOnly") && cookie.includes("SameSite=lax") && cookie.includes("Path=/api/web")));
});
test("BFF meneruskan cookie sebagai bearer serta mempertahankan data multipart", async t => {
  let upstream: RequestInit | undefined;
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => { upstream = init; return Response.json({ success: true, data: { fileId: "f1" } }); });
  const form = new FormData(); form.set("file", new File(["binary-test"], "bukti.png", { type: "image/png" }));
  const req = new NextRequest(`${origin}/api/web/sponsor/banners`, { method: "POST", headers: { origin, cookie: "studenthub_access=private-token" }, body: form });
  const response = await POST(req, params("sponsor/banners"));
  assert.equal(response.status, 200);
  assert.equal(new Headers(upstream?.headers).get("Authorization"), "Bearer private-token");
  assert.ok(new Headers(upstream?.headers).get("Content-Type")?.includes("multipart/form-data; boundary="));
  assert.ok(new TextDecoder().decode(upstream?.body as ArrayBuffer).includes("binary-test"));
});
test("BFF menerima origin HTTPS di belakang nginx dan tetap menuju loopback", async t => {
  let target = "";
  t.mock.method(globalThis, "fetch", async (url: string) => { target = url; return Response.json({ success: false, error: { message: "Gagal masuk." } }, { status: 401 }); });
  const req = new NextRequest(`${origin}/api/web/auth/login`, { method: "POST", headers: { host: "studenthub.example.com", origin: "https://studenthub.example.com", "x-forwarded-proto": "https" } });
  assert.equal((await POST(req, params("auth/login"))).status, 401);
  assert.ok(target.startsWith("http://127.0.0.1:"));
});
test("BFF menolak upload yang melampaui batas sebelum fetch", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("Tidak boleh dipanggil"); });
  const req = new NextRequest(`${origin}/api/web/sponsor/banners`, { method: "POST", headers: { origin, cookie: "studenthub_access=token", "content-length": "99999999" }, body: "file" });
  assert.equal((await POST(req, params("sponsor/banners"))).status, 413);
  assert.equal(fetch.mock.callCount(), 0);
});
test("BFF meneruskan User-Agent browser agar server mengenali browser HP untuk absensi", async t => {
  let upstream: RequestInit | undefined;
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => { upstream = init; return Response.json({ success: true, data: {} }); });
  const phone = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36";
  await GET(request("student/attendance/today", "GET", { cookie: "studenthub_access=token", "user-agent": phone }), params("student/attendance/today"));
  assert.equal(new Headers(upstream?.headers).get("User-Agent"), phone);
});
const cleared = (response: Response) => response.headers.getSetCookie().filter(c => /Max-Age=0/i.test(c) && c.includes("Path=/api/web"));
type Call = { url: string; auth: string | null; body: string | null };
function recordUpstream(t: { mock: { method: (o: object, k: string, f: (...a: never[]) => unknown) => unknown } }, reply: (url: string) => Response) {
  const calls: Call[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, auth: new Headers(init.headers).get("Authorization"), body: typeof init.body === "string" ? init.body : null });
    return reply(url);
  });
  return calls;
}
const refreshed = () => Response.json({ success: true, data: { accessToken: "akses-baru", refreshToken: "refresh-baru", accessTokenExpiresAt: "2030-01-01T00:00:00Z", refreshTokenExpiresAt: "2030-02-01T00:00:00Z" } });
test("BFF logout tanpa access token: sesi server tetap dicabut lewat refresh token, lalu cookie dihapus", async t => {
  const calls = recordUpstream(t, url => url.endsWith("/auth/refresh") ? refreshed() : Response.json({ success: true, data: { revoked: true } }));
  const req = new NextRequest(`${origin}/api/web/auth/logout`, { method: "POST", headers: { origin, cookie: "studenthub_refresh=sisa-refresh" } });
  const response = await POST(req, params("auth/logout"));
  assert.equal(response.status, 200);
  assert.equal(cleared(response).length, 2);
  assert.deepEqual(calls.map(c => c.url.replace(/^http:\/\/127\.0\.0\.1:\d+/, "")), ["/api/v1/auth/refresh", "/api/v1/auth/logout"]);
  assert.equal(JSON.parse(calls[0]!.body ?? "{}").refreshToken, "sisa-refresh");
  assert.equal(calls[1]!.auth, "Bearer akses-baru");
});
test("BFF logout dengan access token yang ditolak (401): cabut lewat refresh token, cookie tetap dihapus", async t => {
  let logoutCalls = 0;
  const calls = recordUpstream(t, url => url.endsWith("/auth/refresh") ? refreshed() : (++logoutCalls === 1 ? Response.json({ success: false, error: { code: "UNAUTHORIZED", message: "Sesi tidak valid." } }, { status: 401 }) : Response.json({ success: true, data: {} })));
  const req = new NextRequest(`${origin}/api/web/auth/logout-all`, { method: "POST", headers: { origin, cookie: "studenthub_access=kedaluwarsa; studenthub_refresh=r" } });
  const response = await POST(req, params("auth/logout-all"));
  assert.equal(response.status, 200);
  assert.equal(cleared(response).length, 2);
  assert.deepEqual(calls.map(c => c.auth), ["Bearer kedaluwarsa", null, "Bearer akses-baru"]);
});
test("BFF logout tanpa cookie apa pun: tidak memanggil backend, cookie dihapus", async t => {
  const calls = recordUpstream(t, () => { throw new Error("Tidak boleh dipanggil"); });
  const response = await POST(request("auth/logout"), params("auth/logout"));
  assert.equal(response.status, 200);
  assert.equal(cleared(response).length, 2);
  assert.equal(calls.length, 0);
});
test("BFF logout saat backend tidak terjangkau tetap menghapus cookie di browser", async t => {
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("fetch failed"); });
  const req = new NextRequest(`${origin}/api/web/auth/logout`, { method: "POST", headers: { origin, cookie: "studenthub_access=a; studenthub_refresh=r" } });
  const response = await POST(req, params("auth/logout"));
  assert.equal(cleared(response).length, 2);
});
