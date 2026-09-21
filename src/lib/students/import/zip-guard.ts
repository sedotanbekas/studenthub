import { inflateRawSync } from "node:zlib";

/**
 * Guard zip-bomb untuk XLSX SEBELUM exceljs membukanya (murni, hanya node:zlib). Membaca central
 * directory, lalu meng-inflate setiap entri dengan `maxOutputLength` = sisa anggaran sehingga yang
 * dihitung adalah byte keluaran NYATA (ukuran di header bisa dipalsukan). ZIP64, enkripsi, dan metode
 * selain stored/deflate ditolak.
 */
export type ZipCheck =
  | { readonly ok: true; readonly entries: number; readonly totalUncompressed: number }
  | { readonly ok: false; readonly reason: string };

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const EOCD_MIN = 22;
const EOCD_MAX_COMMENT = 0xffff;
const CENTRAL_HEADER = 46;
const LOCAL_HEADER = 30;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;
const FLAG_ENCRYPTED = 0x1;
export const DEFAULT_MAX_ZIP_ENTRIES = 2000;

interface CentralEntry {
  readonly flags: number;
  readonly method: number;
  readonly compressedSize: number;
  readonly declaredSize: number;
  readonly localOffset: number;
}

const bad = (reason: string): ZipCheck => ({ ok: false, reason });

export function isZipMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function findEocd(buf: Buffer): number {
  const lowest = Math.max(0, buf.length - EOCD_MIN - EOCD_MAX_COMMENT);
  for (let pos = buf.length - EOCD_MIN; pos >= lowest; pos -= 1) {
    if (buf.readUInt32LE(pos) === SIG_EOCD) return pos;
  }
  return -1;
}

function readCentralDirectory(buf: Buffer, maxEntries: number): CentralEntry[] | string {
  const eocd = findEocd(buf);
  if (eocd < 0) return "struktur ZIP tidak dikenali";
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) return "ZIP64 tidak didukung";
  if (count > maxEntries) return "terlalu banyak entri";
  const entries: CentralEntry[] = [];
  let pos = cdOffset;
  for (let i = 0; i < count; i += 1) {
    if (pos + CENTRAL_HEADER > buf.length || buf.readUInt32LE(pos) !== SIG_CENTRAL) return "central directory rusak";
    entries.push({
      flags: buf.readUInt16LE(pos + 8),
      method: buf.readUInt16LE(pos + 10),
      compressedSize: buf.readUInt32LE(pos + 20),
      declaredSize: buf.readUInt32LE(pos + 24),
      localOffset: buf.readUInt32LE(pos + 42),
    });
    pos += CENTRAL_HEADER + buf.readUInt16LE(pos + 28) + buf.readUInt16LE(pos + 30) + buf.readUInt16LE(pos + 32);
  }
  return entries;
}

function entryData(buf: Buffer, entry: CentralEntry): Buffer | null {
  const at = entry.localOffset;
  if (at + LOCAL_HEADER > buf.length || buf.readUInt32LE(at) !== SIG_LOCAL) return null;
  const start = at + LOCAL_HEADER + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
  const end = start + entry.compressedSize;
  return end > buf.length ? null : buf.subarray(start, end);
}

/** Byte keluaran nyata satu entri, atau string alasan penolakan. */
function realSize(data: Buffer, entry: CentralEntry, budget: number): number | string {
  if ((entry.flags & FLAG_ENCRYPTED) !== 0) return "entri terenkripsi";
  if (entry.method === METHOD_STORED) return data.length;
  if (entry.method !== METHOD_DEFLATE) return "metode kompresi tidak didukung";
  try {
    return inflateRawSync(data, { maxOutputLength: Math.max(1, budget) }).length;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    return code === "ERR_BUFFER_TOO_LARGE" ? "ukuran setelah dekompresi melebihi batas" : "data terkompresi rusak";
  }
}

export function checkZipArchive(bytes: Uint8Array, maxTotalBytes: number, maxEntries: number = DEFAULT_MAX_ZIP_ENTRIES): ZipCheck {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.length < EOCD_MIN || !isZipMagic(buf)) return bad("bukan berkas ZIP");
  const entries = readCentralDirectory(buf, maxEntries);
  if (typeof entries === "string") return bad(entries);
  const declared = entries.reduce((sum, entry) => sum + entry.declaredSize, 0);
  if (declared > maxTotalBytes) return bad("ukuran setelah dekompresi melebihi batas");
  let total = 0;
  for (const entry of entries) {
    const data = entryData(buf, entry);
    if (data === null) return bad("entri ZIP terpotong");
    const size = realSize(data, entry, maxTotalBytes - total);
    if (typeof size === "string") return bad(size);
    total += size;
    if (total > maxTotalBytes) return bad("ukuran setelah dekompresi melebihi batas");
  }
  return { ok: true, entries: entries.length, totalUncompressed: total };
}
