import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { POST as confirmRoute } from "@/app/api/v1/me/totp/confirm/route";
import { POST as setupRoute } from "@/app/api/v1/me/totp/setup/route";
import { POST as logoutRoute } from "@/app/api/v1/auth/logout/route";
import { GET as auditLogsRoute } from "@/app/api/v1/platform/audit-logs/route";
import { base32Decode, totpCodeAt, totpStep } from "@/lib/auth/totp-rules";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { createSessionToken } from "../helpers/auth";
import { disconnect, prisma } from "../helpers/db";
import { createSchool, createSchoolAdmin, createSuperAdmin, TEST_TOTP_SECRET, type TestUser } from "../helpers/factories";
import { callRoute, type Envelope } from "../helpers/request";
import { login, loginOk, me } from "./helpers";

before(resetAllLimiters);
beforeEach(resetAllLimiters);
after(disconnect);

interface SetupBody {
  readonly secret: string;
  readonly otpauthUri: string;
  readonly issuer: string;
  readonly accountName: string;
  readonly digits: number;
  readonly period: number;
}

const setup = (bearer: string) => callRoute<Envelope<SetupBody>>(setupRoute, { method: "POST", url: "/api/v1/me/totp/setup", bearer });
const confirm = (bearer: string, code: string) =>
  callRoute<Envelope<{ enabled: true; enabledAt: string; otherSessionsRevoked: number }>>(confirmRoute, {
    method: "POST",
    url: "/api/v1/me/totp/confirm",
    bearer,
    json: { code },
  });
const platformAudit = (bearer: string) => callRoute<Envelope<unknown>>(auditLogsRoute, { method: "GET", url: "/api/v1/platform/audit-logs", bearer });

const codeFor = (secret: Uint8Array, offset = 0, now = new Date()): string => totpCodeAt(secret, totpStep(now) + offset);
/** Kode yang PASTI salah untuk langkah sekarang ±1. */
function wrongCode(secret: Uint8Array): string {
  const valid = new Set([-1, 0, 1].map((offset) => codeFor(secret, offset)));
  let candidate = 0;
  while (valid.has(String(candidate).padStart(6, "0"))) candidate += 1;
  return String(candidate).padStart(6, "0");
}

async function webSession(user: TestUser): Promise<string> {
  return (await createSessionToken(user.id, { platform: "WEB", deviceId: null })).token;
}

test("SA tanpa TOTP: login boleh, /platform/* 403 TOTP_ENROLLMENT_REQUIRED, /auth/me & logout tetap boleh", async () => {
  const sa = await createSuperAdmin({ totp: false });
  const tokens = await loginOk(sa.email ?? "");
  const blocked = await platformAudit(tokens.accessToken);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body?.error?.code, "TOTP_ENROLLMENT_REQUIRED");
  const mine = await me(tokens.accessToken);
  assert.equal(mine.status, 200);
  const user = mine.body?.data.user as unknown as { totpEnabled: boolean; totpEnrollmentRequired: boolean };
  assert.equal(user.totpEnabled, false);
  assert.equal(user.totpEnrollmentRequired, true);
  assert.deepEqual([...(mine.body?.data.permissions ?? [])].sort(), ["auth.self", "auth.totp"]);
  const out = await callRoute<Envelope<{ revoked: true }>>(logoutRoute, { method: "POST", url: "/api/v1/auth/logout", bearer: tokens.accessToken });
  assert.equal(out.status, 200);
});

test("pendaftaran: setup -> kode salah 422 -> kode benar mengaktifkan, cabut sesi lain, audit, /platform terbuka", async () => {
  const sa = await createSuperAdmin({ totp: false });
  const other = await webSession(sa);
  const token = await webSession(sa);
  const res = await setup(token);
  assert.equal(res.status, 200);
  const body = res.body?.data as SetupBody;
  assert.match(body.secret, /^[A-Z2-7]{32}$/);
  assert.equal(body.accountName, sa.email);
  assert.equal(body.digits, 6);
  assert.equal(body.period, 30);
  assert.ok(body.otpauthUri.startsWith("otpauth://totp/Student%20Hub:"));
  assert.ok(body.otpauthUri.includes(`secret=${body.secret}`));
  const stored = await prisma.user.findUniqueOrThrow({ where: { id: sa.id }, select: { totpSecretEnc: true, totpEnabledAt: true } });
  assert.ok(stored.totpSecretEnc?.startsWith("v1."));
  assert.equal(stored.totpSecretEnc?.includes(body.secret), false, "rahasia tidak disimpan mentah");
  assert.equal(stored.totpEnabledAt, null);

  const secret = base32Decode(body.secret);
  const wrong = await confirm(token, wrongCode(secret));
  assert.equal(wrong.status, 422);
  assert.equal(wrong.body?.error?.code, "TOTP_CODE_INVALID");
  assert.equal((await platformAudit(token)).status, 403);

  const ok = await confirm(token, codeFor(secret));
  assert.equal(ok.status, 200);
  assert.equal(ok.body?.data.enabled, true);
  assert.equal(ok.body?.data.otherSessionsRevoked, 1);
  assert.equal((await platformAudit(token)).status, 200);
  assert.equal((await me(other)).status, 401, "sesi yang dibuat sebelum TOTP aktif dicabut");
  const audit = await prisma.auditLog.findFirst({ where: { action: "auth.totp_enable", entityId: sa.id } });
  assert.ok(audit);
  assert.equal(JSON.stringify(audit.after).includes(body.secret), false);

  const again = await setup(token);
  assert.equal(again.status, 409);
  assert.equal(again.body?.error?.code, "TOTP_ALREADY_ENABLED");
  assert.equal((await confirm(token, codeFor(secret, 1))).body?.error?.code, "TOTP_ALREADY_ENABLED");
});

test("confirm tanpa setup -> 409 TOTP_SETUP_REQUIRED; setup ulang mengganti rahasia lama", async () => {
  const sa = await createSuperAdmin({ totp: false });
  const token = await webSession(sa);
  const none = await confirm(token, "123456");
  assert.equal(none.status, 409);
  assert.equal(none.body?.error?.code, "TOTP_SETUP_REQUIRED");
  const first = base32Decode((await setup(token)).body?.data.secret ?? "");
  const second = base32Decode((await setup(token)).body?.data.secret ?? "");
  assert.notDeepEqual(first, second);
  const stale = await confirm(token, codeFor(first));
  const expectOk = codeFor(first) === codeFor(second);
  assert.equal(stale.status, expectOk ? 200 : 422, "kode dari rahasia lama tidak berlaku");
  if (!expectOk) assert.equal((await confirm(token, codeFor(second))).status, 200);
});

test("confirm: 5 kode salah -> ke-6 429 RATE_LIMITED (kode benar pun)", async () => {
  const sa = await createSuperAdmin({ totp: false });
  const token = await webSession(sa);
  const secret = base32Decode((await setup(token)).body?.data.secret ?? "");
  for (let i = 0; i < 5; i += 1) assert.equal((await confirm(token, wrongCode(secret))).status, 422);
  const locked = await confirm(token, codeFor(secret));
  assert.equal(locked.status, 429);
  assert.equal(locked.body?.error?.code, "RATE_LIMITED");
});

test("setup/confirm: bukan super admin -> 403 FORBIDDEN; wajib ganti kata sandi -> 403 PASSWORD_CHANGE_REQUIRED", async () => {
  const admin = await createSchoolAdmin((await createSchool()).id);
  const denied = await setup(await webSession(admin));
  assert.equal(denied.status, 403);
  assert.equal(denied.body?.error?.code, "FORBIDDEN");
  const fresh = await createSuperAdmin({ totp: false, mustChangePassword: true });
  const res = await setup(await webSession(fresh));
  assert.equal(res.status, 403);
  assert.equal(res.body?.error?.code, "PASSWORD_CHANGE_REQUIRED");
});

test("login SA ber-TOTP: tanpa kode 401 TOTP_REQUIRED, salah 401 TOTP_INVALID (dipadatkan >= 300 ms), benar 200", async () => {
  const sa = await createSuperAdmin();
  const email = sa.email ?? "";
  const started = performance.now();
  const missing = await login(email);
  assert.equal(missing.status, 401);
  assert.equal(missing.body?.error?.code, "TOTP_REQUIRED");
  const wrongStarted = performance.now();
  const wrong = await login(email, { totpCode: wrongCode(TEST_TOTP_SECRET) });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body?.error?.code, "TOTP_INVALID");
  assert.ok(performance.now() - wrongStarted >= 290 && performance.now() - started >= 580, "respons gagal dipadatkan");
  const badPassword = await login(email, { password: "SalahSekali1", totpCode: codeFor(TEST_TOTP_SECRET) });
  assert.equal(badPassword.body?.error?.code, "INVALID_CREDENTIALS", "kata sandi salah tidak membocorkan status TOTP");
  const ok = await login(email, { totpCode: codeFor(TEST_TOTP_SECRET) });
  assert.equal(ok.status, 200);
  assert.equal((await platformAudit(ok.body?.data.accessToken ?? "")).status, 200);
});

test("login SA ber-TOTP: kode yang sama tidak bisa dipakai ulang; langkah berikutnya diterima", async () => {
  const sa = await createSuperAdmin();
  const email = sa.email ?? "";
  const base = totpStep(new Date());
  const code = totpCodeAt(TEST_TOTP_SECRET, base);
  assert.equal((await login(email, { totpCode: code })).status, 200);
  const replay = await login(email, { totpCode: code });
  assert.equal(replay.status, 401);
  assert.equal(replay.body?.error?.code, "TOTP_INVALID");
  const older = await login(email, { totpCode: totpCodeAt(TEST_TOTP_SECRET, base - 1) });
  assert.equal(older.body?.error?.code, "TOTP_INVALID", "langkah lebih lama dari yang terpakai ditolak");
  assert.equal((await login(email, { totpCode: totpCodeAt(TEST_TOTP_SECRET, base + 1) })).status, 200);
  const stored = await prisma.user.findUniqueOrThrow({ where: { id: sa.id }, select: { totpLastUsedStep: true } });
  assert.equal(stored.totpLastUsedStep, base + 1);
});

test("login SA ber-TOTP: dua login paralel dengan kode sama -> tepat satu berhasil", async () => {
  const sa = await createSuperAdmin();
  const code = codeFor(TEST_TOTP_SECRET);
  const results = await Promise.all([login(sa.email ?? "", { totpCode: code }), login(sa.email ?? "", { totpCode: code })]);
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 401]);
  assert.equal(results.find((r) => r.status === 401)?.body?.error?.code, "TOTP_INVALID");
});

test("login SA ber-TOTP: 5 kode salah -> kode benar pun 429 (limiter per akun)", async () => {
  const sa = await createSuperAdmin();
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await login(sa.email ?? "", { totpCode: wrongCode(TEST_TOTP_SECRET) })).body?.error?.code, "TOTP_INVALID");
  }
  const locked = await login(sa.email ?? "", { totpCode: codeFor(TEST_TOTP_SECRET) });
  assert.equal(locked.status, 429);
});

test("totpCode diabaikan untuk akun tanpa TOTP (admin sekolah) dan format salah -> 400", async () => {
  const admin = await createSchoolAdmin((await createSchool()).id);
  assert.equal((await login(admin.email ?? "", { totpCode: "000000" })).status, 200);
  const bad = await login(admin.email ?? "", { totpCode: "12ab" });
  assert.equal(bad.status, 400);
  assert.equal(bad.body?.error?.code, "VALIDATION_FAILED");
});
