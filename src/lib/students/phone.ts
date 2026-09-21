/**
 * Normalisasi nomor HP Indonesia ke format "+628…". Menerima awalan 0, 62, atau +62; spasi, tanda
 * hubung, titik, dan kurung diabaikan. Badan nomor setelah awalan wajib cocok ^8[1-9]\d{6,10}$.
 */
const PHONE_BODY = /^8[1-9]\d{6,10}$/;
const SEPARATORS = /[\s\-.()]/g;

function stripPrefix(compact: string): string | null {
  if (compact.startsWith("+62")) return compact.slice(3);
  if (compact.startsWith("62")) return compact.slice(2);
  if (compact.startsWith("0")) return compact.slice(1);
  return null;
}

export function normalizeIdPhone(raw: string): string | null {
  const body = stripPrefix(raw.replace(SEPARATORS, ""));
  if (body === null || !PHONE_BODY.test(body)) return null;
  return `+62${body}`;
}
