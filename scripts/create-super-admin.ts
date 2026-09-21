/**
 * Membuat akun SUPER_ADMIN dari CLI (super admin pertama di VPS; tidak pernah lewat migrasi/seed):
 *
 *   pnpm db:super-admin --email admin@medialab.co.id --name "Nama Lengkap"
 *
 * - Menolak bila email sudah terdaftar (peran apa pun).
 * - Kata sandi sementara di-generate, di-hash bcrypt cost 10, dan dicetak SEKALI ke stdout.
 *   Wajib diganti saat login pertama (mustChangePassword) dan kedaluwarsa 14 hari.
 * - Tidak mencetak apa pun yang sensitif selain kata sandi sementara itu sendiri.
 */
import { config } from "dotenv";
import { z } from "zod";

export interface SuperAdminArgs {
  readonly email: string;
  readonly name: string;
}

export type ParseResult = { readonly ok: true; readonly value: SuperAdminArgs } | { readonly ok: false; readonly error: string };

export interface CreatedSuperAdmin {
  readonly userId: string;
  readonly email: string;
  readonly temporaryPassword: string;
  readonly tempPasswordExpiresAt: Date;
}

export class SuperAdminExistsError extends Error {
  constructor(email: string) {
    super(`Email ${email} sudah terdaftar; super admin tidak dibuat.`);
    this.name = "SuperAdminExistsError";
  }
}

export const USAGE = 'Pemakaian: pnpm db:super-admin --email <email> --name "<Nama Lengkap>"';
const EMAIL_MAX = 191;
const NAME_MIN = 3;
const NAME_MAX = 100;
const OPTION = /^--(email|name)(?:=(.*))?$/s;

const argsSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Email tidak valid.").max(EMAIL_MAX, "Email terlalu panjang.")),
  name: z.string().trim().min(NAME_MIN, `Nama minimal ${NAME_MIN} karakter.`).max(NAME_MAX, `Nama maksimal ${NAME_MAX} karakter.`),
});

/** Parser argv tanpa dependensi: `--email x`, `--email=x`, `--name "Nama"`; token `--` diabaikan. */
export function parseSuperAdminArgs(argv: readonly string[]): ParseResult {
  const values: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === "--") continue;
    const match = OPTION.exec(arg);
    if (!match) return { ok: false, error: `Argumen tidak dikenal: ${arg}` };
    const key = match[1] as string;
    const value = match[2] ?? argv[i + 1];
    if (match[2] === undefined) i += 1;
    if (value === undefined || value.startsWith("--")) return { ok: false, error: `Nilai --${key} wajib diisi.` };
    values[key] = value;
  }
  const parsed = argsSchema.safeParse(values);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path[0];
    const missing = typeof field === "string" && values[field] === undefined;
    return { ok: false, error: missing ? `--${field} wajib diisi.` : (issue?.message ?? "Argumen tidak valid.") };
  }
  return { ok: true, value: parsed.data };
}

const isUniqueViolation = (error: unknown): boolean => (error as { code?: unknown } | null)?.code === "P2002";

/** Membuat SUPER_ADMIN + audit dalam satu transaksi. Modul DB dimuat malas (setelah .env dibaca). */
export async function createSuperAdminAccount(input: SuperAdminArgs, now: Date = new Date()): Promise<CreatedSuperAdmin> {
  const [{ prisma }, { withTx }, { writeAudit }, password] = await Promise.all([
    import("../src/lib/db"),
    import("../src/lib/tx"),
    import("../src/lib/audit"),
    import("../src/lib/auth/password"),
  ]);
  const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) throw new SuperAdminExistsError(input.email);
  const temporaryPassword = password.generateTempPassword();
  const passwordHash = await password.hashPassword(temporaryPassword, password.BCRYPT_COST);
  const tempPasswordExpiresAt = new Date(now.getTime() + password.TEMP_PASSWORD_TTL_MS);
  try {
    const userId = await withTx(async (tx) => {
      const created = await tx.user.create({
        data: { role: "SUPER_ADMIN", email: input.email, name: input.name, passwordHash, mustChangePassword: true, tempPasswordExpiresAt },
        select: { id: true },
      });
      await writeAudit(
        tx,
        { action: "user.create", entityType: "User", entityId: created.id, after: { role: "SUPER_ADMIN", email: input.email, name: input.name, via: "cli" } },
        { principal: null, ip: null, userAgent: "cli:create-super-admin" },
      );
      return created.id;
    });
    return { userId, email: input.email, temporaryPassword, tempPasswordExpiresAt };
  } catch (error) {
    if (isUniqueViolation(error)) throw new SuperAdminExistsError(input.email);
    throw error;
  }
}

async function main(): Promise<void> {
  config({ quiet: true });
  const parsed = parseSuperAdminArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(parsed.error);
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  const { prisma } = await import("../src/lib/db");
  try {
    const created = await createSuperAdminAccount(parsed.value);
    console.log(`Super admin dibuat: ${created.email}`);
    console.log(`Kata sandi sementara (hanya ditampilkan SEKALI, catat sekarang): ${created.temporaryPassword}`);
    console.log(`Wajib diganti saat login pertama; kedaluwarsa ${created.tempPasswordExpiresAt.toISOString()}.`);
  } catch (error) {
    const reason = error instanceof SuperAdminExistsError ? error.message : `Gagal membuat super admin (${error instanceof Error ? error.name : "galat"}).`;
    console.error(reason);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (/create-super-admin\.ts$/.test(process.argv[1] ?? "")) void main();
