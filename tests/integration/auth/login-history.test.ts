/**
 * Sakelar TOTP super admin mati (bawaan sejak 2026-10-02) + riwayat masuk super admin: perangkat, IP,
 * penanda perangkat baru, percobaan gagal, dan daftar GET /platform/login-history.
 */
import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { GET as loginHistoryRoute } from "@/app/api/v1/platform/login-history/route";
import { GET as platformUsersRoute } from "@/app/api/v1/platform/users/route";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { createSessionToken } from "../helpers/auth";
import { disconnect, prisma } from "../helpers/db";
import { createSchool, createSchoolAdmin, createSuperAdmin } from "../helpers/factories";
import { callRoute, type Envelope } from "../helpers/request";
import { login, loginOk, me, uniqDeviceId, waitForLoginFailures as waitForFailures } from "./helpers";

beforeEach(resetAllLimiters);
after(disconnect);

const WINDOWS_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";

interface LoginEventBody {
  readonly id: string;
  readonly status: string;
  readonly failureReason: string | null;
  readonly user: { readonly id: string; readonly name: string };
  readonly device: string;
  readonly isNewDevice: boolean;
  readonly ipAddress: string | null;
  readonly deviceId: string | null;
}

const history = (bearer: string, query = "") =>
  callRoute<Envelope<LoginEventBody[]>>(loginHistoryRoute, { method: "GET", url: `/api/v1/platform/login-history${query}`, bearer });

test("TOTP mati: super admin ber-TOTP masuk tanpa kode; tanpa TOTP tidak dibatasi pendaftaran", async () => {
  const enrolled = await createSuperAdmin();
  const tokens = await loginOk(enrolled.email ?? "", { userAgent: WINDOWS_CHROME });
  assert.equal(tokens.user.role, "SUPER_ADMIN");

  const fresh = await createSuperAdmin({ totp: false });
  const session = await loginOk(fresh.email ?? "");
  const profile = await me(session.accessToken);
  assert.equal((profile.body?.data.user as { totpEnrollmentRequired?: boolean }).totpEnrollmentRequired, false);
  const users = await callRoute<Envelope<unknown[]>>(platformUsersRoute, { method: "GET", url: "/api/v1/platform/users", bearer: session.accessToken });
  assert.equal(users.status, 200, "fitur platform langsung terbuka tanpa pendaftaran TOTP");
});

test("riwayat masuk: login berhasil mencatat perangkat, IP, sesi, dan penanda perangkat baru", async () => {
  const sa = await createSuperAdmin();
  const laptop = uniqDeviceId();
  const first = await loginOk(sa.email ?? "", { deviceId: laptop, userAgent: WINDOWS_CHROME, ip: "10.20.30.40" });
  await loginOk(sa.email ?? "", { deviceId: laptop, userAgent: WINDOWS_CHROME });
  await loginOk(sa.email ?? "", { deviceId: uniqDeviceId(), userAgent: IPHONE_SAFARI });

  const rows = await prisma.loginEvent.findMany({ where: { userId: sa.id }, orderBy: { createdAt: "asc" } });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.isNewDevice), [true, false, true]);
  const [firstRow] = rows;
  assert.equal(firstRow?.succeeded, true);
  assert.equal(firstRow?.sessionId, first.sessionId);
  assert.equal(firstRow?.ipAddress, "10.20.30.40");
  assert.equal(firstRow?.deviceId, laptop, "id browser web desktop tetap dicatat walau sesi tidak menyimpannya");
  assert.deepEqual([firstRow?.deviceType, firstRow?.browser, firstRow?.os], ["DESKTOP", "Chrome 141", "Windows 10/11"]);
  assert.equal(firstRow?.city, null, "IP privat -> tanpa perkiraan lokasi");
  assert.equal(rows[2]?.deviceModel, "Apple iPhone");
});

test("riwayat masuk: kata sandi salah ke akun super admin dicatat gagal; akun peran lain juga dicatat", async () => {
  const sa = await createSuperAdmin();
  const wrong = await login(sa.email ?? "", { password: "SalahSekali#2026", userAgent: IPHONE_SAFARI });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body?.error?.code, "INVALID_CREDENTIALS", "respons tetap seragam");
  await waitForFailures(sa.id, 1);
  const failed = await prisma.loginEvent.findFirstOrThrow({ where: { userId: sa.id } });
  assert.deepEqual([failed.succeeded, failed.failureCode, failed.sessionId, failed.isNewDevice], [false, "WRONG_PASSWORD", null, false]);

  const school = await createSchool();
  const admin = await createSchoolAdmin(school.id);
  assert.equal((await login(admin.email ?? "", { password: "SalahSekali#2026" })).status, 401);
  await waitForFailures(admin.id, 1);
  await loginOk(admin.email ?? "");
  const events = await prisma.loginEvent.findMany({ where: { userId: admin.id }, orderBy: { createdAt: "asc" } });
  assert.deepEqual(events.map((e) => [e.succeeded, e.failureCode]), [[false, "WRONG_PASSWORD"], [true, null]]);
});

test("GET /platform/login-history: terbaru dulu, filter status & akun; admin sekolah 403", async () => {
  const sa = await createSuperAdmin();
  await loginOk(sa.email ?? "", { userAgent: WINDOWS_CHROME });
  await login(sa.email ?? "", { password: "SalahSekali#2026" });
  await waitForFailures(sa.id, 1);
  const viewer = await createSessionToken((await createSuperAdmin()).id);

  const mine = await history(viewer.token, `?userId=${sa.id}`);
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.body?.data.map((r) => r.status), ["FAILED", "SUCCESS"]);
  assert.equal(mine.body?.data[0]?.failureReason, "WRONG_PASSWORD");
  assert.equal(mine.body?.data[1]?.device, "Chrome 141 · Windows 10/11 · Komputer");
  assert.equal(mine.body?.data[1]?.user.id, sa.id);
  assert.equal(mine.body?.meta?.total, 2);

  const failedOnly = await history(viewer.token, `?userId=${sa.id}&status=FAILED`);
  assert.deepEqual(failedOnly.body?.data.map((r) => r.status), ["FAILED"]);

  const school = await createSchool();
  const admin = await createSessionToken((await createSchoolAdmin(school.id)).id);
  assert.equal((await history(admin.token)).status, 403);
});

test("GET /platform/login-history: semua peran tercatat; filter peran & sekolah; baris memuat peran + sekolah", async () => {
  const school = await createSchool();
  const other = await createSchool();
  const admin = await createSchoolAdmin(school.id);
  const outsider = await createSchoolAdmin(other.id);
  await loginOk(admin.email ?? "", { userAgent: WINDOWS_CHROME });
  await loginOk(outsider.email ?? "", { userAgent: WINDOWS_CHROME });
  const viewer = await createSessionToken((await createSuperAdmin()).id);

  const bySchool = await history(viewer.token, `?schoolId=${school.id}`);
  assert.equal(bySchool.status, 200);
  const rows = (bySchool.body?.data ?? []) as unknown as Array<LoginEventBody & { user: { role: string; school: { id: string } | null } }>;
  assert.deepEqual(rows.map((r) => r.user.id), [admin.id]);
  assert.equal(rows[0]?.user.role, "SCHOOL_ADMIN");
  assert.equal(rows[0]?.user.school?.id, school.id);

  const admins = await history(viewer.token, `?role=SCHOOL_ADMIN&schoolId=${other.id}`);
  assert.deepEqual(admins.body?.data.map((r) => r.user.id), [outsider.id]);
  assert.equal((await history(viewer.token, `?role=STUDENT&schoolId=${school.id}`)).body?.data.length, 0);
});
