import { createHash, timingSafeEqual } from "node:crypto";

const digest = (value: string): Buffer => createHash("sha256").update(value, "utf8").digest();

/**
 * Bandingkan header X-Job-Secret dengan JOB_SECRET dalam waktu konstan. Keduanya di-hash sha256
 * dulu agar panjangnya selalu sama (timingSafeEqual menolak panjang berbeda) dan panjang secret
 * tidak bocor lewat waktu. Header hilang/kosong atau secret server kosong → false.
 */
export function verifyJobSecret(header: string | null, secret: string): boolean {
  if (!header || !secret) return false;
  return timingSafeEqual(digest(header), digest(secret));
}
