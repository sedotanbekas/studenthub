import { sharp, SHARP_INPUT } from "./sharp-runtime";

/**
 * Hash perseptual dHash 64-bit (16 hex): greyscale → resize 9×8 (fill) → bandingkan piksel bertetangga
 * per baris (kiri > kanan = 1). Tahan re-encode, resize & sedikit perubahan kecerahan — dipakai untuk
 * DUPLICATE_SELFIE dan penanda bukti mirip (bukan sha256 yang berubah oleh edit sekecil apa pun).
 */
export const NEAR_DUPLICATE_MAX_DISTANCE = 6;

const HASH_WIDTH = 9;
const HASH_HEIGHT = 8;
const HASH_BITS = 64;
const HASH_RE = /^[0-9a-f]{16}$/i;

export async function dHash(bytes: Uint8Array): Promise<string> {
  const { data, info } = await sharp(bytes, SHARP_INPUT)
    .flatten({ background: "#ffffff" })
    .greyscale()
    .resize(HASH_WIDTH, HASH_HEIGHT, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const stride = info.channels;
  const pixel = (x: number, y: number): number => data[(y * HASH_WIDTH + x) * stride] ?? 0;
  const bits = Array.from({ length: HASH_BITS }, (_, i) => {
    const y = Math.floor(i / 8);
    const x = i % 8;
    return pixel(x, y) > pixel(x + 1, y) ? 1 : 0;
  });
  return Array.from({ length: HASH_BITS / 4 }, (_, n) =>
    bits.slice(n * 4, n * 4 + 4).reduce<number>((acc, bit) => (acc << 1) | bit, 0).toString(16),
  ).join("");
}

export function hammingDistance(a: string, b: string): number {
  if (!HASH_RE.test(a) || !HASH_RE.test(b)) throw new RangeError("Hash perseptual harus 16 karakter hex");
  const diff = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  return diff.toString(2).split("").filter((c) => c === "1").length;
}
