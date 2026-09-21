import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { verifyPassword } from "@/lib/auth/password";
import {
  createSuperAdminAccount,
  parseSuperAdminArgs,
  SuperAdminExistsError,
} from "../../../scripts/create-super-admin";
import { disconnect, prisma } from "../helpers/db";
import { uniqEmail } from "../helpers/factories";
import { loginOk } from "./helpers";

after(disconnect);

const SCRIPT = path.join(process.cwd(), "scripts", "create-super-admin.ts");

test("parseSuperAdminArgs: bentuk --opsi nilai dan --opsi=nilai; email di-lowercase", () => {
  assert.deepEqual(parseSuperAdminArgs(["--email", " Admin@Medialab.CO.ID ", "--name", "Nama Admin"]), {
    ok: true,
    value: { email: "admin@medialab.co.id", name: "Nama Admin" },
  });
  assert.deepEqual(parseSuperAdminArgs(["--", "--email=a@b.id", "--name=Budi"]), { ok: true, value: { email: "a@b.id", name: "Budi" } });
});

test("parseSuperAdminArgs: argumen hilang, tidak dikenal, atau tidak valid ditolak", () => {
  const errorOf = (argv: string[]): string => {
    const result = parseSuperAdminArgs(argv);
    assert.equal(result.ok, false, argv.join(" "));
    return result.ok ? "" : result.error;
  };
  assert.match(errorOf(["--email", "a@b.id"]), /--name wajib/);
  assert.match(errorOf(["--name", "Budi"]), /--email wajib/);
  assert.match(errorOf(["--email", "--name", "Budi"]), /--email wajib/);
  assert.match(errorOf(["--email", "bukan-email", "--name", "Budi"]), /Email tidak valid/);
  assert.match(errorOf(["--email", "a@b.id", "--name", "AB"]), /minimal 3/);
  assert.match(errorOf(["--role", "STUDENT"]), /tidak dikenal/);
});

test("createSuperAdminAccount: wajib ganti kata sandi, kedaluwarsa 14 hari, audit, bisa login", async () => {
  const email = uniqEmail("sa-cli");
  const now = new Date();
  const created = await createSuperAdminAccount({ email, name: "Super Admin CLI" }, now);
  assert.match(created.temporaryPassword, /^[A-Za-z0-9]{10}$/);
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: created.userId },
    select: { role: true, mustChangePassword: true, tempPasswordExpiresAt: true, passwordHash: true, schoolId: true },
  });
  assert.equal(user.role, "SUPER_ADMIN");
  assert.equal(user.mustChangePassword, true);
  assert.equal(user.schoolId, null);
  assert.equal(user.tempPasswordExpiresAt?.getTime(), now.getTime() + 14 * 86_400_000);
  assert.match(user.passwordHash, /^\$2[aby]\$10\$/);
  assert.equal(await verifyPassword(created.temporaryPassword, user.passwordHash), true);
  const audit = await prisma.auditLog.findFirst({ where: { action: "user.create", entityId: created.userId } });
  assert.ok(audit);
  assert.doesNotMatch(JSON.stringify(audit.after), new RegExp(created.temporaryPassword));
  const tokens = await loginOk(email, { password: created.temporaryPassword });
  assert.equal(tokens.mustChangePassword, true);
});

test("createSuperAdminAccount: email sudah terdaftar (beda huruf besar pun) ditolak", async () => {
  const email = uniqEmail("sa-dup");
  await createSuperAdminAccount({ email, name: "Pertama" });
  await assert.rejects(() => createSuperAdminAccount({ email, name: "Kedua" }), SuperAdminExistsError);
  await assert.rejects(() => createSuperAdminAccount({ email: email.toUpperCase(), name: "Ketiga" }), SuperAdminExistsError);
  assert.equal(await prisma.user.count({ where: { email } }), 1);
});

test("CLI: mencetak kata sandi sementara sekali; argumen salah -> exit 2 tanpa membuat akun", () => {
  const email = uniqEmail("sa-run");
  const run = spawnSync(process.execPath, ["--import", "tsx", SCRIPT, "--email", email, "--name", "Admin Dari CLI"], {
    encoding: "utf8",
    env: process.env,
    timeout: 60_000,
  });
  assert.equal(run.status, 0, run.stderr);
  const lines = run.stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 3, run.stdout);
  assert.match(lines[0] ?? "", new RegExp(`Super admin dibuat: ${email.replace(/[.+]/g, "\\$&")}`));
  assert.match(lines[1] ?? "", /SEKALI.*: [A-Za-z0-9]{10}$/);
  const bad = spawnSync(process.execPath, ["--import", "tsx", SCRIPT, "--email", "bukan-email"], { encoding: "utf8", env: process.env, timeout: 60_000 });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /Pemakaian/);
});
