/**
 * Reset darurat TOTP 2FA super admin dari CLI (HP autentikator hilang / TOTP_ENC_KEY terlanjur diganti):
 *
 *   pnpm db:totp-reset --email admin@medialab.co.id
 *
 * - Hanya akun SUPER_ADMIN. Rahasia TOTP dihapus, semua sesi akun dicabut, dan kejadian diaudit
 *   (`auth.totp_reset`, userAgent `cli:totp-reset`).
 * - Setelah login berikutnya akun wajib mendaftar ulang lewat /me/totp/setup -> /me/totp/confirm
 *   (sebelum itu aksi /platform/* ditolak 403 TOTP_ENROLLMENT_REQUIRED).
 * - Tidak mencetak data sensitif apa pun.
 */
import { config } from "dotenv";
import { z } from "zod";

export type TotpResetArgsResult = { readonly ok: true; readonly email: string } | { readonly ok: false; readonly error: string };

export const USAGE = "Pemakaian: pnpm db:totp-reset --email <email super admin>";
const OPTION = /^--email(?:=(.*))?$/s;
const emailSchema = z.string().trim().toLowerCase().pipe(z.email("Email tidak valid.").max(191, "Email terlalu panjang."));

/** Parser argv: `--email x` atau `--email=x`; token `--` diabaikan. */
export function parseTotpResetArgs(argv: readonly string[]): TotpResetArgsResult {
  let raw: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === "--") continue;
    const match = OPTION.exec(arg);
    if (!match) return { ok: false, error: `Argumen tidak dikenal: ${arg}` };
    raw = match[1] ?? argv[i + 1];
    if (match[1] === undefined) i += 1;
    if (raw === undefined || raw.startsWith("--")) return { ok: false, error: "Nilai --email wajib diisi." };
  }
  if (raw === undefined) return { ok: false, error: "--email wajib diisi." };
  const parsed = emailSchema.safeParse(raw);
  return parsed.success ? { ok: true, email: parsed.data } : { ok: false, error: parsed.error.issues[0]?.message ?? "Email tidak valid." };
}

async function main(): Promise<void> {
  config({ quiet: true });
  const parsed = parseTotpResetArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(parsed.error);
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  const [{ prisma }, service] = await Promise.all([import("../src/lib/db"), import("../src/lib/auth/totp-service")]);
  try {
    const result = await service.resetSuperAdminTotp(parsed.email);
    console.log(`TOTP super admin ${parsed.email} di-reset (sebelumnya ${result.wasEnabled ? "aktif" : "belum aktif"}).`);
    console.log(`${result.sessionsRevoked} sesi dicabut. Akun wajib mendaftar ulang TOTP setelah login berikutnya.`);
  } catch (error) {
    const reason = error instanceof service.TotpResetTargetError ? error.message : `Gagal reset TOTP (${error instanceof Error ? error.name : "galat"}).`;
    console.error(reason);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (/totp-reset\.ts$/.test(process.argv[1] ?? "")) void main();
