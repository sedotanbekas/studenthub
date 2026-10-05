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
  assert.equal(cookies.length, 3);
  assert.ok(cookies.every(cookie => cookie.includes("HttpOnly") && cookie.includes("SameSite=lax")));
  const tokens = cookies.filter(cookie => /^studenthub_(access|refresh)=/.test(cookie));
  assert.equal(tokens.length, 2);
  assert.ok(tokens.every(cookie => cookie.includes("Path=/api/web")));
  // Penanda sesi (tanpa rahasia) untuk render server /hub: Path=/, umur sama dengan refresh token.
  const hint = cookies.find(cookie => cookie.startsWith("studenthub_session="));
  assert.match(hint ?? "", /^studenthub_session=1; Path=\/; Expires=Fri, 01 Feb 2030 00:00:00 GMT;/);
  assert.doesNotMatch(hint ?? "", /private/);
});
test("BFF refresh yang berhasil memperpanjang penanda sesi bersama token baru", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ success: true, data: { accessToken: "a2", refreshToken: "r2", accessTokenExpiresAt: "2030-01-01T00:00:00Z", refreshTokenExpiresAt: "2030-03-01T00:00:00Z" } }));
  const response = await POST(request("auth/refresh", "POST", { cookie: "studenthub_refresh=r1" }), params("auth/refresh"));
  assert.equal(response.status, 200);
  assert.match(response.headers.getSetCookie().find(c => c.startsWith("studenthub_session=")) ?? "", /Expires=Fri, 01 Mar 2030/);
});
test("BFF refresh yang ditolak menghapus penanda sesi (token tidak disentuh)", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ success: false, error: { code: "UNAUTHORIZED", message: "Sesi tidak valid." } }, { status: 401 }));
  const response = await POST(request("auth/refresh", "POST", { cookie: "studenthub_refresh=basi; studenthub_session=1" }), params("auth/refresh"));
  assert.equal(response.status, 401);
  assert.deepEqual(response.headers.getSetCookie().map(c => c.split(";")[0]), ["studenthub_session="]);
});
test("BFF GET /session: status sesi selalu 200 (tanpa galat konsol), tanpa memanggil backend", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("Tidak boleh dipanggil"); });
  const anonymous = await GET(request("session", "GET"), params("session"));
  assert.equal(anonymous.status, 200);
  assert.deepEqual((await anonymous.json()).data, { active: false });
  assert.equal(anonymous.headers.get("cache-control"), "private, no-store");
  assert.equal(anonymous.headers.getSetCookie().length, 0);
  // Sesi dari sebelum penanda ada: penanda dipasang agar kunjungan berikutnya langsung memuat sesi.
  const legacy = await GET(request("session", "GET", { cookie: "studenthub_refresh=r" }), params("session"));
  assert.deepEqual((await legacy.json()).data, { active: true });
  const legacyHint = legacy.headers.getSetCookie().find(c => c.startsWith("studenthub_session=1; Path=/;")) ?? "";
  assert.match(legacyHint, /Max-Age=2592000;.*HttpOnly/);
  // Penanda tertinggal tanpa token: dihapus.
  const stale = await GET(request("session", "GET", { cookie: "studenthub_session=1" }), params("session"));
  assert.deepEqual((await stale.json()).data, { active: false });
  assert.match(stale.headers.getSetCookie().join("\n"), /studenthub_session=; Path=\/; Max-Age=0/);
  // Hanya GET; metode lain tetap ditolak sebagai jalur bukan kontrak.
  assert.equal((await POST(request("session"), params("session"))).status, 404);
  assert.equal(fetch.mock.callCount(), 0);
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
test("BFF meneruskan berkas biner tanpa cache dengan nosniff & CSP sandbox (aman dibuka sebagai tab)", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/webp", "content-disposition": "inline; filename=\"bukti.webp\"" } }));
  const req = new NextRequest(`${origin}/api/web/files/f1`, { method: "GET", headers: { origin, cookie: "studenthub_access=private-token" } });
  const response = await GET(req, params("files/f1"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/webp");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("content-security-policy") ?? "", /sandbox/);
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
const cleared = (response: Response) => {
  const all = response.headers.getSetCookie().filter(c => /Max-Age=0/i.test(c));
  assert.ok(all.some(c => c.startsWith("studenthub_session=") && c.includes("Path=/;")), "penanda sesi ikut dihapus");
  return all.filter(c => c.includes("Path=/api/web"));
};
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

const IMP_TOKENS = { accessToken: "imp-access", refreshToken: "imp-refresh", accessTokenExpiresAt: "2030-01-01T00:00:00Z", refreshTokenExpiresAt: "2030-01-01T00:30:00Z", user: { id: "u1", name: "Siswa" } };
const cookieNames = (response: Response) => response.headers.getSetCookie().map(c => c.split(";")[0]);

test("Masuk sebagai: token akun target jadi cookie, refresh super admin disimpan di cookie stash HttpOnly", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ success: true, data: IMP_TOKENS }));
  const response = await POST(request("platform/users/u1/impersonate", "POST", { cookie: "studenthub_access=sa-access; studenthub_refresh=sa-refresh" }), params("platform/users/u1/impersonate"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.accessToken, undefined);
  assert.equal(body.data.refreshToken, undefined);
  const names = cookieNames(response);
  assert.ok(names.includes("studenthub_access=imp-access") && names.includes("studenthub_refresh=imp-refresh"));
  const stash = response.headers.getSetCookie().find(c => c.startsWith("studenthub_impersonator=")) ?? "";
  assert.match(stash, /^studenthub_impersonator=sa-refresh; Path=\/api\/web;.*HttpOnly/);
});

test("Akhiri Masuk sebagai: sesi dicabut di backend lalu sesi super admin dipulihkan dari stash", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({ success: true, data: { ended: true } }));
  const cookie = "studenthub_access=imp-access; studenthub_refresh=imp-refresh; studenthub_impersonator=sa-refresh";
  const response = await POST(request("auth/impersonation/end", "POST", { cookie }), params("auth/impersonation/end"));
  assert.equal(response.status, 200);
  const [url, init] = fetch.mock.calls[0]?.arguments as [string, RequestInit];
  assert.match(url, /\/api\/v1\/auth\/impersonation\/end$/);
  assert.equal(new Headers(init.headers).get("authorization"), "Bearer imp-access");
  const names = cookieNames(response);
  assert.ok(names.includes("studenthub_refresh=sa-refresh"), names.join(","));
  assert.ok(names.includes("studenthub_access=") && names.includes("studenthub_impersonator=") && names.includes("studenthub_session=1"));
});

test("refresh Masuk sebagai ditolak (30 menit habis): sesi super admin dipulihkan + header X-Impersonation-Ended", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ success: false, error: { code: "SESSION_INVALID", message: "x" } }, { status: 401 }));
  const cookie = "studenthub_refresh=imp-refresh; studenthub_impersonator=sa-refresh; studenthub_session=1";
  const response = await POST(request("auth/refresh", "POST", { cookie }), params("auth/refresh"));
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("x-impersonation-ended"), "1");
  const names = cookieNames(response);
  assert.ok(names.includes("studenthub_refresh=sa-refresh") && names.includes("studenthub_impersonator="));
  assert.ok(!names.includes("studenthub_session="), "penanda sesi tidak dihapus: sesi super admin berlanjut");
});

test("login biasa menghapus stash lama; keluar saat Masuk sebagai juga mencabut sesi super admin yang disimpan", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ success: true, data: IMP_TOKENS }));
  const login = await POST(request("auth/login", "POST", { cookie: "studenthub_impersonator=lama" }), params("auth/login"));
  assert.ok(cookieNames(login).includes("studenthub_impersonator="));
  t.mock.restoreAll();
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({ success: true, data: { accessToken: "sa-access2", revoked: true } }));
  const cookie = "studenthub_access=imp-access; studenthub_refresh=imp-refresh; studenthub_impersonator=sa-refresh";
  const logout = await POST(request("auth/logout", "POST", { cookie }), params("auth/logout"));
  assert.equal(logout.status, 200);
  const bodies = fetch.mock.calls.map(c => String((c.arguments[1] as RequestInit | undefined)?.body ?? ""));
  assert.ok(bodies.some(b => b.includes("sa-refresh")), "stash ditukar lalu sesi super admin dicabut");
  assert.ok(cookieNames(logout).includes("studenthub_impersonator="));
});

test("Akhiri Masuk sebagai: refresh token super admin langsung ditukar sehingga sesi siap tanpa 401 pertama", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async (url: string) => String(url).endsWith("/auth/refresh")
    ? Response.json({ success: true, data: { accessToken: "sa-access-new", refreshToken: "sa-refresh-new", accessTokenExpiresAt: "2030-01-01T00:00:00Z", refreshTokenExpiresAt: "2030-02-01T00:00:00Z" } })
    : Response.json({ success: true, data: { ended: true } }));
  const cookie = "studenthub_access=imp-access; studenthub_refresh=imp-refresh; studenthub_impersonator=sa-refresh";
  const response = await POST(request("auth/impersonation/end", "POST", { cookie }), params("auth/impersonation/end"));
  assert.equal(response.status, 200);
  const refreshBody = String((fetch.mock.calls.find(c => String(c.arguments[0]).endsWith("/auth/refresh"))?.arguments[1] as RequestInit | undefined)?.body ?? "");
  assert.match(refreshBody, /sa-refresh/);
  const names = cookieNames(response);
  assert.ok(names.includes("studenthub_access=sa-access-new") && names.includes("studenthub_refresh=sa-refresh-new"), names.join(","));
  assert.ok(names.includes("studenthub_impersonator="));
});

test("Akhiri pada sesi biasa (409 NOT_IMPERSONATING) tidak memulihkan stash; balapan refresh 409 tidak menimpa cookie", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ success: false, error: { code: "NOT_IMPERSONATING", message: "x" } }, { status: 409 }));
  const normal = await POST(request("auth/impersonation/end", "POST", { cookie: "studenthub_access=a; studenthub_refresh=r; studenthub_impersonator=basi" }), params("auth/impersonation/end"));
  assert.equal(normal.status, 409);
  assert.deepEqual(cookieNames(normal), []);
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async (url: string) => String(url).endsWith("/auth/refresh")
    ? Response.json({ success: false, error: { code: "REFRESH_RACE", message: "x" } }, { status: 409 })
    : Response.json({ success: true, data: { ended: true } }));
  const race = await POST(request("auth/impersonation/end", "POST", { cookie: "studenthub_access=imp; studenthub_refresh=imp-r; studenthub_impersonator=sa-refresh" }), params("auth/impersonation/end"));
  assert.equal(race.status, 200);
  assert.deepEqual(cookieNames(race), [], "tab lain sudah memulihkan sesi super admin");
});

test("login baru dengan stash tertinggal: sesi super admin yang tersimpan dicabut, bukan sekadar dibuang", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({ success: true, data: IMP_TOKENS }));
  const login = await POST(request("auth/login", "POST", { cookie: "studenthub_impersonator=sa-lama" }), params("auth/login"));
  assert.equal(login.status, 200);
  const bodies = fetch.mock.calls.map(c => String((c.arguments[1] as RequestInit | undefined)?.body ?? ""));
  assert.ok(bodies.some(b => b.includes("sa-lama")), "stash ditukar lalu dicabut");
  assert.ok(cookieNames(login).includes("studenthub_impersonator="));
});
