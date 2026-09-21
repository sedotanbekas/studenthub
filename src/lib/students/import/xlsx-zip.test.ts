import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import ExcelJS from "exceljs";
import { XLSX_PRIORITY_PARTS, normalizeXlsxZip } from "./xlsx-zip";
import { checkZipArchive, entryData, readCentralDirectory } from "./zip-guard";

const names = (bytes: Uint8Array): string[] => {
  const entries = readCentralDirectory(Buffer.from(bytes));
  assert.ok(typeof entries !== "string", String(entries));
  return entries.map((entry) => entry.name.toString("utf8"));
};

/** ZIP deflate minimal dengan bit data descriptor (bit 3) menyala di local header. */
function zipWithDescriptorFlag(parts: Readonly<Record<string, string>>): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(parts)) {
    const nameBuf = Buffer.from(name);
    const data = deflateRawSync(Buffer.from(text));
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(0x0008, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0008, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(Buffer.byteLength(text), 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(centrals.length / 2, 8);
  eocd.writeUInt16LE(centrals.length / 2, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, eocd]));
}

test("normalizeXlsxZip: metadata (relasi, workbook, sharedStrings, styles) dipindah ke depan, sisanya urut asli", async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("Siswa").addRow(["NISN", new Date(Date.UTC(2012, 4, 17))]);
  workbook.addWorksheet("Kelas").addRow(["VII A"]);
  const original = new Uint8Array(await workbook.xlsx.writeBuffer());
  assert.ok(names(original).indexOf("xl/workbook.xml") > names(original).indexOf("xl/worksheets/sheet1.xml"), "prasyarat: urutan asli exceljs");
  const normalized = normalizeXlsxZip(original);
  assert.ok(normalized);
  const ordered = names(normalized);
  assert.deepEqual(ordered.slice(0, 4), [...XLSX_PRIORITY_PARTS]);
  const rest = names(original).filter((name) => !(XLSX_PRIORITY_PARTS as readonly string[]).includes(name));
  assert.deepEqual(ordered.slice(4), rest);
  assert.ok(checkZipArchive(normalized, 8 * 1024 * 1024).ok);
  const roundTrip = new ExcelJS.Workbook();
  await roundTrip.xlsx.load(Buffer.from(normalized) as unknown as ArrayBuffer);
  assert.equal(roundTrip.getWorksheet("Siswa")?.getCell("A1").value, "NISN");
});

test("normalizeXlsxZip: sharedStrings & relasi kosong disisipkan bila tidak ada; bit data descriptor dibuang", () => {
  const normalized = normalizeXlsxZip(zipWithDescriptorFlag({ "xl/workbook.xml": "<workbook/>", "xl/worksheets/sheet1.xml": "<worksheet/>" }));
  assert.ok(normalized);
  const buf = Buffer.from(normalized);
  const entries = readCentralDirectory(buf);
  assert.ok(typeof entries !== "string");
  assert.deepEqual(entries.map((e) => e.name.toString()), ["xl/_rels/workbook.xml.rels", "xl/workbook.xml", "xl/sharedStrings.xml", "xl/worksheets/sheet1.xml"]);
  for (const entry of entries) {
    assert.equal(buf.readUInt16LE(entry.localOffset + 6) & 0x0008, 0, entry.name.toString());
    assert.equal(buf.readUInt32LE(entry.localOffset + 18), entry.compressedSize);
  }
  const sheet = entries[3];
  assert.ok(sheet);
  const data = entryData(buf, sheet);
  assert.ok(data);
  assert.equal(inflateRawSync(data).toString(), "<worksheet/>");
});

test("normalizeXlsxZip: struktur rusak -> null", () => {
  assert.equal(normalizeXlsxZip(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])), null);
});
