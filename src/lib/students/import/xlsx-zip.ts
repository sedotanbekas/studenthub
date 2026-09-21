import { crc32 } from "node:zlib";
import { entryData, readCentralDirectory, type CentralEntry } from "./zip-guard";

/**
 * Normalisasi ZIP XLSX untuk pembaca streaming ExcelJS (murni, hanya Buffer + node:zlib).
 *
 * WorkbookReader ExcelJS 4.4 hanya mem-parse worksheet langsung dari stream bila sharedStrings &
 * relasi workbook SUDAH terbaca; jika tidak (urutan umum berkas Excel/ExcelJS: worksheet sebelum
 * sharedStrings/workbook.xml) worksheet ditulis ke berkas sementara, lalu terbukti ada race yang
 * membuat xl/workbook.xml terlewati -> TypeError pada berkas kecil ber-sheet ganda (termasuk templat
 * kita sendiri). Maka entri metadata dipindah ke depan (relasi -> workbook -> sharedStrings -> styles,
 * sisanya urutan asli), sharedStrings/relasi kosong disisipkan bila tidak ada, dan local header ditulis
 * ulang dari central directory (tanpa data descriptor). Data terkompresi disalin apa adanya.
 * Panggil HANYA setelah `checkZipArchive` lolos.
 */
const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const LOCAL_HEADER = 30;
const CENTRAL_HEADER = 46;
const EOCD_SIZE = 22;
const VERSION = 20;
/** Hanya bit 11 (nama UTF-8) yang dipertahankan; bit 3 (data descriptor) dibuang. */
const FLAG_UTF8 = 0x0800;
const METHOD_STORED = 0;

export const XLSX_PRIORITY_PARTS = ["xl/_rels/workbook.xml.rels", "xl/workbook.xml", "xl/sharedStrings.xml", "xl/styles.xml"] as const;

const EMPTY_PARTS: Readonly<Record<string, string>> = {
  "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`,
  "xl/sharedStrings.xml": `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="0" uniqueCount="0"></sst>`,
};

interface ZipPart {
  readonly entry: CentralEntry;
  readonly data: Buffer;
}

function storedPart(name: string, text: string): ZipPart {
  const data = Buffer.from(text, "utf8");
  const entry: CentralEntry = {
    name: Buffer.from(name, "utf8"), flags: FLAG_UTF8, method: METHOD_STORED, modTime: 0, modDate: 0,
    crc32: crc32(data), compressedSize: data.length, declaredSize: data.length, localOffset: 0,
  };
  return { entry, data };
}

const rankOf = (part: ZipPart): number => {
  const index = (XLSX_PRIORITY_PARTS as readonly string[]).indexOf(part.entry.name.toString("utf8"));
  return index < 0 ? XLSX_PRIORITY_PARTS.length : index;
};

function localHeader(entry: CentralEntry): Buffer {
  const header = Buffer.alloc(LOCAL_HEADER);
  header.writeUInt32LE(SIG_LOCAL, 0);
  header.writeUInt16LE(VERSION, 4);
  header.writeUInt16LE(entry.flags & FLAG_UTF8, 6);
  header.writeUInt16LE(entry.method, 8);
  header.writeUInt16LE(entry.modTime, 10);
  header.writeUInt16LE(entry.modDate, 12);
  header.writeUInt32LE(entry.crc32, 14);
  header.writeUInt32LE(entry.compressedSize, 18);
  header.writeUInt32LE(entry.declaredSize, 22);
  header.writeUInt16LE(entry.name.length, 26);
  return header;
}

function centralHeader(entry: CentralEntry, offset: number): Buffer {
  const header = Buffer.alloc(CENTRAL_HEADER);
  header.writeUInt32LE(SIG_CENTRAL, 0);
  header.writeUInt16LE(VERSION, 4);
  header.writeUInt16LE(VERSION, 6);
  header.writeUInt16LE(entry.flags & FLAG_UTF8, 8);
  header.writeUInt16LE(entry.method, 10);
  header.writeUInt16LE(entry.modTime, 12);
  header.writeUInt16LE(entry.modDate, 14);
  header.writeUInt32LE(entry.crc32, 16);
  header.writeUInt32LE(entry.compressedSize, 20);
  header.writeUInt32LE(entry.declaredSize, 24);
  header.writeUInt16LE(entry.name.length, 28);
  header.writeUInt32LE(offset, 42);
  return header;
}

function endOfCentralDirectory(count: number, size: number, offset: number): Buffer {
  const eocd = Buffer.alloc(EOCD_SIZE);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(count, 8);
  eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(size, 12);
  eocd.writeUInt32LE(offset, 16);
  return eocd;
}

function serialize(parts: readonly ZipPart[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { entry, data } of parts) {
    locals.push(localHeader(entry), entry.name, data);
    centrals.push(centralHeader(entry, offset), entry.name);
    offset += LOCAL_HEADER + entry.name.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  return Buffer.concat([...locals, directory, endOfCentralDirectory(parts.length, directory.length, offset)]);
}

/** Susun ulang ZIP XLSX (lihat komentar modul); null bila struktur ZIP tidak dapat dibaca. */
export function normalizeXlsxZip(bytes: Uint8Array): Uint8Array | null {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = readCentralDirectory(buf);
  if (typeof entries === "string") return null;
  const parts: ZipPart[] = [];
  for (const entry of entries) {
    const data = entryData(buf, entry);
    if (data === null) return null;
    parts.push({ entry, data });
  }
  const names = new Set(parts.map((part) => part.entry.name.toString("utf8")));
  const injected = Object.entries(EMPTY_PARTS).filter(([name]) => !names.has(name)).map(([name, text]) => storedPart(name, text));
  const ordered = [...parts, ...injected].map((part, index) => ({ part, index }));
  ordered.sort((a, b) => rankOf(a.part) - rankOf(b.part) || a.index - b.index);
  return new Uint8Array(serialize(ordered.map(({ part }) => part)));
}
