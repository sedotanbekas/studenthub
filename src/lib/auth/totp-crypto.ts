import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Enkripsi rahasia TOTP saat disimpan (User.totpSecretEnc): AES-256-GCM, IV acak 12 byte, tag 16 byte,
 * AAD = "totp:<userId>" (ciphertext tidak bisa dipindah ke akun lain). Format:
 *   v1.<iv base64url>.<ciphertext base64url>.<tag base64url>
 * Kunci = TOTP_ENC_KEY (32 byte, hex 64 karakter atau base64), terpisah dari rahasia lain.
 */
const VERSION = "v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEX_KEY = /^[0-9a-fA-F]{64}$/;
const BASE64_KEY = /^[A-Za-z0-9+/]{43}=$/;

/** Kunci 32 byte dari hex/base64; format lain -> null. */
export function parseTotpKey(raw: string): Buffer | null {
  const value = raw.trim();
  if (HEX_KEY.test(value)) return Buffer.from(value, "hex");
  if (BASE64_KEY.test(value)) {
    const bytes = Buffer.from(value, "base64");
    return bytes.length === KEY_BYTES ? bytes : null;
  }
  return null;
}

const aad = (userId: string): Buffer => Buffer.from(`totp:${userId}`, "utf8");

export function encryptTotpSecret(secret: Uint8Array, userId: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad(userId));
  const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), ciphertext.toString("base64url"), tag.toString("base64url")].join(".");
}

/** Dekripsi; format/versi salah, tag tidak cocok, kunci atau user berbeda -> null (tidak pernah melempar). */
export function decryptTotpSecret(blob: string, userId: string, key: Buffer): Buffer | null {
  const parts = blob.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  const [, ivText, cipherText, tagText] = parts as [string, string, string, string];
  const iv = Buffer.from(ivText, "base64url");
  const tag = Buffer.from(tagText, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad(userId));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(cipherText, "base64url")), decipher.final()]);
  } catch {
    return null;
  }
}
