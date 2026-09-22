import { createHmac, timingSafeEqual } from "node:crypto";
import type { UserRole } from "@prisma/client";

/**
 * Aturan murni TOTP (RFC 6238 di atas HOTP RFC 4226): HMAC-SHA1, 6 digit, periode 30 detik, jendela
 * toleransi ±1 langkah. Tanpa Prisma/DB. Anti-replay: langkah yang diterima harus LEBIH BESAR dari
 * langkah terakhir yang pernah dipakai (User.totpLastUsedStep).
 */
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_WINDOW_STEPS = 1;
/** Panjang rahasia baru (160 bit, sesuai rekomendasi RFC 4226 untuk SHA1). */
export const TOTP_SECRET_BYTES = 20;
export const TOTP_ISSUER = "Student Hub";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const CODE_PATTERN = /^\d{6}$/;

export type TotpVerification = { readonly ok: true; readonly step: number } | { readonly ok: false; readonly reason: "INVALID" | "REPLAY" };

/** Base32 RFC 4648 tanpa padding (format rahasia di aplikasi autentikator). */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

/** Dekode base32 (tak peka huruf; spasi, tanda hubung, dan padding `=` diabaikan). */
export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) throw new Error("Karakter base32 tidak valid");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** HOTP (RFC 4226): HMAC-SHA1 atas counter 8 byte big-endian lalu truncation dinamis. */
export function hotp(secret: Uint8Array, counter: number, digits: number = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secret).update(message).digest();
  const offset = (digest[digest.length - 1] as number) & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** Nomor langkah TOTP pada suatu instan (T = floor(unix / 30)). */
export function totpStep(now: Date): number {
  return Math.floor(now.getTime() / 1000 / TOTP_PERIOD_SECONDS);
}

export function totpCodeAt(secret: Uint8Array, step: number, digits: number = TOTP_DIGITS): string {
  return hotp(secret, step, digits);
}

export function isTotpCodeFormat(code: string): boolean {
  return CODE_PATTERN.test(code);
}

/**
 * Verifikasi kode terhadap langkah sekarang ±1. Semua kandidat selalu dibandingkan (waktu konstan,
 * timingSafeEqual). Kode cocok tetapi langkahnya <= lastUsedStep -> REPLAY.
 */
export function verifyTotp(secret: Uint8Array, code: string, now: Date, lastUsedStep: number | null): TotpVerification {
  if (!isTotpCodeFormat(code)) return { ok: false, reason: "INVALID" };
  const given = Buffer.from(code, "ascii");
  const current = totpStep(now);
  let matched: number | null = null;
  for (let offset = -TOTP_WINDOW_STEPS; offset <= TOTP_WINDOW_STEPS; offset += 1) {
    const candidate = Buffer.from(totpCodeAt(secret, current + offset), "ascii");
    if (timingSafeEqual(candidate, given) && matched === null) matched = current + offset;
  }
  if (matched === null) return { ok: false, reason: "INVALID" };
  if (lastUsedStep !== null && matched <= lastUsedStep) return { ok: false, reason: "REPLAY" };
  return { ok: true, step: matched };
}

export interface OtpauthInput {
  readonly secretBase32: string;
  readonly accountName: string;
  readonly issuer: string;
}

/** Key URI Format (Google Authenticator): otpauth://totp/Issuer:akun?secret=...&issuer=... */
export function buildOtpauthUri(input: OtpauthInput): string {
  const issuer = encodeURIComponent(input.issuer);
  const label = `${issuer}:${encodeURIComponent(input.accountName)}`;
  const params = [
    `secret=${input.secretBase32}`,
    `issuer=${issuer}`,
    "algorithm=SHA1",
    `digits=${TOTP_DIGITS}`,
    `period=${TOTP_PERIOD_SECONDS}`,
  ];
  return `otpauth://totp/${label}?${params.join("&")}`;
}

/** SUPER_ADMIN wajib TOTP: selama belum aktif, hanya aksi yang diizinkan saat pendaftaran TOTP. */
export function requiresTotpEnrollment(role: UserRole, totpEnabledAt: Date | null): boolean {
  return role === "SUPER_ADMIN" && totpEnabledAt === null;
}
