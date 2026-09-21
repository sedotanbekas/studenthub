import { hash, verify } from "@node-rs/bcrypt";
import { randomBytes } from "node:crypto";

/**
 * Hash kata sandi bcrypt (native, dijalankan di threadpool libuv sehingga tidak memblokir event loop).
 * Kata sandi pilihan manusia: cost 10. Kata sandi sementara hasil generate (acak ~50 bit,
 * kedaluwarsa 14 hari): cost 8 agar impor 1.000 siswa tetap cepat.
 */
export const BCRYPT_COST = 10;
export const TEMP_PASSWORD_BCRYPT_COST = 8;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_BYTES = 72;
export const TEMP_PASSWORD_LENGTH = 10;
export const TEMP_PASSWORD_TTL_MS = 14 * 24 * 60 * 60 * 1000;
/** Tanpa karakter ambigu (0/O, 1/l/I). */
const TEMP_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";

/** Hash acak cost 10 untuk menyamakan waktu respons login saat akun tidak ditemukan. */
const DUMMY_HASH = "$2b$10$CwTycUXWue0Thq9StjUM0uJ8hsgYoV9Ch0lRd8cFGEcxP4.7GkyC2";

export function hashPassword(plain: string, cost: number = BCRYPT_COST): Promise<string> {
  return hash(plain, cost);
}

/** Selalu menjalankan satu verifikasi bcrypt (hash dummy bila null) agar waktu seragam. */
export async function verifyPassword(plain: string, passwordHash: string | null): Promise<boolean> {
  const matched = await verify(plain, passwordHash ?? DUMMY_HASH);
  return passwordHash !== null && matched;
}

/** Kata sandi sementara 10 karakter; dijamin memuat huruf & angka. rand dapat diinjeksi untuk test. */
export function generateTempPassword(rand: (size: number) => Uint8Array = randomBytes): string {
  for (;;) {
    const bytes = rand(TEMP_PASSWORD_LENGTH * 2);
    const chars: string[] = [];
    for (const byte of bytes) {
      if (byte >= 256 - (256 % TEMP_ALPHABET.length)) continue;
      chars.push(TEMP_ALPHABET[byte % TEMP_ALPHABET.length] as string);
      if (chars.length === TEMP_PASSWORD_LENGTH) break;
    }
    const candidate = chars.join("");
    if (candidate.length === TEMP_PASSWORD_LENGTH && /\d/.test(candidate) && /[a-z]/i.test(candidate)) return candidate;
  }
}

export type PasswordContext = { nisn?: string | null; nis?: string | null; email?: string | null; birthDate?: Date | null };
export type PasswordViolation = "TOO_SHORT" | "TOO_LONG" | "NEEDS_LETTER" | "NEEDS_DIGIT" | "CONTAINS_PERSONAL_DATA" | "TOO_COMMON";

const COMMON = new Set(["password1", "password123", "12345678a", "qwerty123", "admin1234", "bismillah1", "indonesia1", "sekolah123", "studenthub1"]);

function personalTokens(ctx: PasswordContext): string[] {
  const tokens = [ctx.nisn, ctx.nis, ctx.email?.split("@")[0]];
  if (ctx.birthDate) {
    const iso = ctx.birthDate.toISOString().slice(0, 10);
    const [y, m, d] = iso.split("-");
    tokens.push(`${d}${m}${y}`, `${y}${m}${d}`);
  }
  return tokens.filter((t): t is string => typeof t === "string" && t.length >= 4).map((t) => t.toLowerCase());
}

/** Kebijakan kata sandi; kosong = lolos. */
export function checkPasswordPolicy(plain: string, ctx: PasswordContext = {}): PasswordViolation[] {
  const violations: PasswordViolation[] = [];
  if (plain.length < PASSWORD_MIN_LENGTH) violations.push("TOO_SHORT");
  if (Buffer.byteLength(plain, "utf8") > PASSWORD_MAX_BYTES) violations.push("TOO_LONG");
  if (!/\p{L}/u.test(plain)) violations.push("NEEDS_LETTER");
  if (!/\d/.test(plain)) violations.push("NEEDS_DIGIT");
  const lower = plain.toLowerCase();
  if (personalTokens(ctx).some((token) => lower.includes(token))) violations.push("CONTAINS_PERSONAL_DATA");
  if (COMMON.has(lower)) violations.push("TOO_COMMON");
  return violations;
}

export const PASSWORD_VIOLATION_MESSAGES: Readonly<Record<PasswordViolation, string>> = {
  TOO_SHORT: `Kata sandi minimal ${PASSWORD_MIN_LENGTH} karakter.`,
  TOO_LONG: `Kata sandi maksimal ${PASSWORD_MAX_BYTES} byte.`,
  NEEDS_LETTER: "Kata sandi harus memuat huruf.",
  NEEDS_DIGIT: "Kata sandi harus memuat angka.",
  CONTAINS_PERSONAL_DATA: "Kata sandi tidak boleh memuat NISN, NIS, email, atau tanggal lahir.",
  TOO_COMMON: "Kata sandi terlalu umum.",
};
