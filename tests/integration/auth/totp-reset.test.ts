import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { totpCodeAt, totpStep } from "@/lib/auth/totp-rules";
import { resetSuperAdminTotp, TotpResetTargetError } from "@/lib/auth/totp-service";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { parseTotpResetArgs } from "../../../scripts/totp-reset";
import { createSessionToken } from "../helpers/auth";
import { disconnect, prisma } from "../helpers/db";
import { createSchool, createSchoolAdmin, createSuperAdmin, TEST_TOTP_SECRET } from "../helpers/factories";
import { login, me } from "./helpers";

beforeEach(resetAllLimiters);
after(disconnect);

const SCRIPT = path.join(process.cwd(), "scripts", "totp-reset.ts");

test("parseTotpResetArgs: --email x / --email=x, lowercase; argumen salah ditolak", () => {
  assert.deepEqual(parseTotpResetArgs(["--email", " Admin@Medialab.CO.ID "]), { ok: true, email: "admin@medialab.co.id" });
  assert.deepEqual(parseTotpResetArgs(["--", "--email=a@b.id"]), { ok: true, email: "a@b.id" });
  const errorOf = (argv: string[]): string => {
    const result = parseTotpResetArgs(argv);
    assert.equal(result.ok, false, argv.join(" "));
    return result.ok ? "" : result.error;
  };
  assert.match(errorOf([]), /--email wajib/);
  assert.match(errorOf(["--email"]), /--email wajib/);
  assert.match(errorOf(["--email", "bukan-email"]), /Email tidak valid/);
  assert.match(errorOf(["--role", "x"]), /tidak dikenal/);
});

test("resetSuperAdminTotp: hapus rahasia, cabut semua sesi, audit; login berikutnya wajib daftar ulang", async () => {
  const sa = await createSuperAdmin();
  const session = await createSessionToken(sa.id, { platform: "WEB", deviceId: null });
  const result = await resetSuperAdminTotp(sa.email ?? "");
  assert.deepEqual(result, { userId: sa.id, wasEnabled: true, sessionsRevoked: 1 });
  const row = await prisma.user.findUniqueOrThrow({
    where: { id: sa.id },
    select: { totpSecretEnc: true, totpEnabledAt: true, totpLastUsedStep: true },
  });
  assert.deepEqual(row, { totpSecretEnc: null, totpEnabledAt: null, totpLastUsedStep: null });
  assert.equal((await me(session.token)).status, 401);
  const audit = await prisma.auditLog.findFirst({ where: { action: "auth.totp_reset", entityId: sa.id } });
  assert.equal(audit?.actorId, null);
  assert.equal(audit?.userAgent, "cli:totp-reset");
  const again = await login(sa.email ?? "");
  assert.equal(again.status, 200, "tanpa TOTP: login dengan kata sandi saja");
  const mine = await me(again.body?.data.accessToken ?? "");
  assert.equal((mine.body?.data.user as unknown as { totpEnrollmentRequired: boolean }).totpEnrollmentRequired, true);
});

test("resetSuperAdminTotp: email bukan super admin / tidak ada -> TotpResetTargetError", async () => {
  const admin = await createSchoolAdmin((await createSchool()).id);
  await assert.rejects(() => resetSuperAdminTotp(admin.email ?? ""), TotpResetTargetError);
  await assert.rejects(() => resetSuperAdminTotp("tidak-ada@studenthub.test"), TotpResetTargetError);
});

test("rahasia TOTP tak terbaca (kunci diganti) -> login 500 INTERNAL_ERROR tanpa membocorkan detail", async () => {
  const sa = await createSuperAdmin();
  await prisma.user.update({ where: { id: sa.id }, data: { totpSecretEnc: "v1.AAAAAAAAAAAAAAAA.AAAA.AAAAAAAAAAAAAAAAAAAAAA" } });
  const res = await login(sa.email ?? "", { totpCode: totpCodeAt(TEST_TOTP_SECRET, totpStep(new Date())) });
  assert.equal(res.status, 500);
  assert.equal(res.body?.error?.code, "INTERNAL_ERROR");
});

test("CLI db:totp-reset: argumen salah exit 2; email tak dikenal exit 1", () => {
  const run = (args: string) => spawnSync(`pnpm exec tsx "${SCRIPT}" ${args}`, { shell: true, encoding: "utf8", env: process.env });
  const bad = run("--email bukan-email");
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /Pemakaian: pnpm db:totp-reset/);
  const unknown = run("--email tidak-ada-sama-sekali@studenthub.test");
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /tidak ditemukan/);
});
