import ExcelJS from "exceljs";
import { unprocessable } from "@/lib/http/errors";
import { IMPORT_MAX_COLUMNS, IMPORT_MAX_UNCOMPRESSED_BYTES } from "./constants";
import { cellText } from "./cell-parsers";
import { decodeCsvBytes, parseCsv } from "./csv";
import type { RawImportRow } from "./validate-rows";
import { checkZipArchive, isZipMagic } from "./zip-guard";

/**
 * Membaca berkas impor menjadi header + baris mentah. Jenis berkas dari magic byte (ZIP = XLSX, selain
 * itu CSV). XLSX melewati guard zip-bomb SEBELUM exceljs; hanya sheet pertama yang dibaca.
 * Nomor baris = nomor baris spreadsheet (header biasanya baris 1).
 */
export interface ImportSheet {
  readonly header: readonly unknown[];
  readonly rows: readonly RawImportRow[];
}

const INVALID_FILE = "Berkas harus XLSX atau CSV (UTF-8) yang valid.";

const fileInvalid = (message: string = INVALID_FILE) => unprocessable("IMPORT_FILE_INVALID", message);

const hasContent = (values: readonly unknown[]): boolean => values.some((value) => cellText(value) !== null);

function splitHeader(rows: readonly RawImportRow[]): ImportSheet {
  const headerIndex = rows.findIndex((row) => hasContent(row.values));
  if (headerIndex < 0) throw unprocessable("IMPORT_EMPTY", "Berkas kosong: baris header tidak ditemukan.");
  return { header: rows[headerIndex]?.values ?? [], rows: rows.slice(headerIndex + 1) };
}

async function loadWorkbook(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const guard = checkZipArchive(bytes, IMPORT_MAX_UNCOMPRESSED_BYTES);
  if (!guard.ok) throw fileInvalid(`Berkas XLSX ditolak: ${guard.reason}.`);
  const workbook = new ExcelJS.Workbook();
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  try {
    await workbook.xlsx.load(copy);
  } catch {
    throw fileInvalid("Berkas XLSX rusak atau tidak dapat dibaca.");
  }
  return workbook;
}

async function readXlsx(bytes: Uint8Array): Promise<ImportSheet> {
  const workbook = await loadWorkbook(bytes);
  const sheet = workbook.worksheets[0];
  if (sheet === undefined) throw fileInvalid("Berkas XLSX tidak memiliki sheet.");
  const rows: RawImportRow[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const values = Array.isArray(row.values) ? row.values.slice(1, IMPORT_MAX_COLUMNS + 1) : [];
    rows.push({ row: rowNumber, values: Array.from(values, (value) => value as unknown) });
  });
  return splitHeader(rows);
}

function readCsv(bytes: Uint8Array): ImportSheet {
  const text = decodeCsvBytes(bytes);
  if (text === null) throw fileInvalid();
  const rows = parseCsv(text).map((values, index) => ({ row: index + 1, values: values.slice(0, IMPORT_MAX_COLUMNS) }));
  return splitHeader(rows);
}

export async function readImportFile(bytes: Uint8Array): Promise<ImportSheet> {
  if (bytes.length === 0) throw unprocessable("IMPORT_EMPTY", "Berkas kosong.");
  return isZipMagic(bytes) ? readXlsx(bytes) : readCsv(bytes);
}
