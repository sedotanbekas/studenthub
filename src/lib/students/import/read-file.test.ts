import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { crc32 } from "node:zlib";
import ExcelJS from "exceljs";
import { AppError } from "@/lib/http/errors";
import { IMPORT_MAX_COLUMNS, IMPORT_MAX_ROWS } from "./constants";
import { readImportFile } from "./read-file";

type SheetSpec = { readonly name: string; readonly rows: readonly (readonly unknown[])[] };

async function xlsx(sheets: readonly SheetSpec[]): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  for (const spec of sheets) {
    const sheet = workbook.addWorksheet(spec.name);
    spec.rows.forEach((row, i) => {
      if (row.length > 0) sheet.getRow(i + 1).values = [...row] as ExcelJS.CellValue[];
    });
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

/** ZIP "stored" minimal (tanpa kompresi) untuk menyusun XLSX rusak secara presisi. */
function storedZip(entries: Readonly<Record<string, string>>): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name);
    const data = Buffer.from(text);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(entries).length, 8);
  eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, eocd]));
}

const exceljsTempFiles = (): string[] => readdirSync(tmpdir()).filter((name) => name.startsWith(`tmp-${process.pid}-`));

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof AppError && error.code === code);
}

const dataRows = (count: number): unknown[][] => Array.from({ length: count }, (_, i) => [`00${String(10_000_000 + i)}`, `Siswa ${i}`]);

test("XLSX: hanya sheet pertama; header = baris berisi pertama; nomor baris spreadsheet", async () => {
  const bytes = await xlsx([
    { name: "Siswa", rows: [[], ["NISN", "Nama"], ["0012345678", "Ani"], [], ["0012345679", "Budi"]] },
    { name: "Kelas", rows: [["Kelas"], ["VII A"]] },
  ]);
  const sheet = await readImportFile(bytes);
  assert.deepEqual(sheet.header, ["NISN", "Nama"]);
  assert.deepEqual(sheet.rows.map((r) => [r.row, ...r.values]), [[3, "0012345678", "Ani"], [5, "0012345679", "Budi"]]);
});

test("XLSX: sel bertanggal terbaca sebagai Date (format sel dibaca)", async () => {
  const bytes = await xlsx([{ name: "Siswa", rows: [["Tanggal Lahir"], [new Date(Date.UTC(2012, 4, 17))]] }]);
  const sheet = await readImportFile(bytes);
  const value = sheet.rows[0]?.values[0];
  assert.ok(value instanceof Date, String(value));
  assert.equal(value.toISOString().slice(0, 10), "2012-05-17");
});

test("XLSX: kolom dibatasi IMPORT_MAX_COLUMNS", async () => {
  const wide = Array.from({ length: IMPORT_MAX_COLUMNS + 30 }, (_, i) => `K${i}`);
  const sheet = await readImportFile(await xlsx([{ name: "Siswa", rows: [wide, ["x"]] }]));
  assert.equal(sheet.header.length, IMPORT_MAX_COLUMNS);
});

test("XLSX: tepat batas baris diterima; melewati batas -> IMPORT_TOO_MANY_ROWS", async () => {
  const header = ["NISN", "Nama"];
  const ok = await readImportFile(await xlsx([{ name: "Siswa", rows: [header, ...dataRows(IMPORT_MAX_ROWS)] }]));
  assert.equal(ok.rows.length, IMPORT_MAX_ROWS);
  await expectCode(readImportFile(await xlsx([{ name: "Siswa", rows: [header, ...dataRows(IMPORT_MAX_ROWS + 1)] }])), "IMPORT_TOO_MANY_ROWS");
});

test("XLSX: berkas sementara exceljs selalu dibersihkan (normal, terlalu banyak baris, banyak sheet)", async () => {
  const before = exceljsTempFiles();
  await readImportFile(await xlsx([{ name: "A", rows: [["NISN"], ["1"]] }, { name: "B", rows: [["x"]] }, { name: "C", rows: [["y"]] }]));
  await expectCode(readImportFile(await xlsx([{ name: "A", rows: [["NISN"], ...dataRows(IMPORT_MAX_ROWS + 5)] }, { name: "B", rows: [["x"]] }])), "IMPORT_TOO_MANY_ROWS");
  assert.deepEqual(exceljsTempFiles(), before);
});

test("XLSX rusak (XML worksheet cacat / tanpa sheet) -> IMPORT_FILE_INVALID, tidak crash", async () => {
  const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
  const book = `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const broken = storedZip({ "xl/_rels/workbook.xml.rels": rels, "xl/workbook.xml": book, "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c></row><<<` });
  await expectCode(readImportFile(broken), "IMPORT_FILE_INVALID");
  await expectCode(readImportFile(storedZip({ "xl/workbook.xml": book })), "IMPORT_FILE_INVALID");
});

test("XLSX tanpa sharedStrings (sel inlineStr, mis. dari generator lain) tetap terbaca", async () => {
  const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
  const book = `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const sheetXml = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>NISN</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>0012345678</t></is></c><c r="B2"><v>41046</v></c></row></sheetData></worksheet>`;
  const sheet = await readImportFile(storedZip({ "xl/worksheets/sheet1.xml": sheetXml, "xl/workbook.xml": book, "xl/_rels/workbook.xml.rels": rels }));
  assert.deepEqual(sheet.header, ["NISN"]);
  assert.deepEqual(sheet.rows, [{ row: 2, values: ["0012345678", 41046] }]);
});

test("CSV: melewati batas baris -> IMPORT_TOO_MANY_ROWS; tepat batas diterima", async () => {
  const csv = (count: number) => new TextEncoder().encode(["NISN,Nama", ...dataRows(count).map((r) => r.join(","))].join("\n"));
  assert.equal((await readImportFile(csv(IMPORT_MAX_ROWS))).rows.length, IMPORT_MAX_ROWS);
  await expectCode(readImportFile(csv(IMPORT_MAX_ROWS + 1)), "IMPORT_TOO_MANY_ROWS");
});
