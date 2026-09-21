import { Readable } from "node:stream";
import ExcelJS from "exceljs";
import { AppError, unprocessable } from "@/lib/http/errors";
import { IMPORT_MAX_COLUMNS, IMPORT_MAX_ROWS, IMPORT_MAX_UNCOMPRESSED_BYTES } from "./constants";
import { cellText } from "./cell-parsers";
import { decodeCsvBytes, parseCsv } from "./csv";
import type { RawImportRow } from "./validate-rows";
import { normalizeXlsxZip } from "./xlsx-zip";
import { checkZipArchive, isZipMagic } from "./zip-guard";

/**
 * Membaca berkas impor menjadi header + baris mentah. Jenis berkas dari magic byte (ZIP = XLSX, selain
 * itu CSV). XLSX melewati guard zip-bomb, dinormalisasi (xlsx-zip.ts), lalu dibaca STREAMING (ExcelJS
 * WorkbookReader): hanya sheet pertama, dan pembacaan berhenti begitu baris berisi melewati batas
 * (header + maks baris) -> 422 IMPORT_TOO_MANY_ROWS. CSV juga berhenti lebih awal dengan batas yang sama.
 * Nomor baris = nomor baris spreadsheet (header biasanya baris 1).
 */
export interface ImportSheet {
  readonly header: readonly unknown[];
  readonly rows: readonly RawImportRow[];
}

const INVALID_FILE = "Berkas harus XLSX atau CSV (UTF-8) yang valid.";
/** Baris berisi maksimal yang dikumpulkan: header + IMPORT_MAX_ROWS baris data. */
const MAX_CONTENT_ROWS = IMPORT_MAX_ROWS + 1;

const XLSX_READER_OPTIONS = {
  worksheets: "emit",
  sharedStrings: "cache",
  // Gaya di-cache agar sel berformat tanggal menjadi Date (sama seperti pembacaan non-streaming).
  styles: "cache",
  hyperlinks: "ignore",
  entries: "ignore",
} as const;

const fileInvalid = (message: string = INVALID_FILE) => unprocessable("IMPORT_FILE_INVALID", message);
const tooManyRows = () =>
  unprocessable("IMPORT_TOO_MANY_ROWS", `Maksimal ${IMPORT_MAX_ROWS} baris data per impor.`, { maxRows: IMPORT_MAX_ROWS });

const hasContent = (values: readonly unknown[]): boolean => values.some((value) => cellText(value) !== null);

function splitHeader(rows: readonly RawImportRow[]): ImportSheet {
  const [header, ...data] = rows;
  if (header === undefined) throw unprocessable("IMPORT_EMPTY", "Berkas kosong: baris header tidak ditemukan.");
  return { header: header.values, rows: data };
}

/** Kolom 1..IMPORT_MAX_COLUMNS dari `row.values` exceljs (indeks 0 selalu kosong). */
function rowValues(row: ExcelJS.Row): unknown[] {
  const values = Array.isArray(row.values) ? row.values.slice(1, IMPORT_MAX_COLUMNS + 1) : [];
  return Array.from(values, (value) => value as unknown);
}

interface SheetResult {
  readonly rows: RawImportRow[];
  readonly overflow: boolean;
}

/** Kumpulkan baris berisi satu worksheet; BERHENTI (overflow) begitu melewati header + maks baris. */
async function collectSheet(sheet: AsyncIterable<ExcelJS.Row>): Promise<SheetResult> {
  const rows: RawImportRow[] = [];
  for await (const row of sheet) {
    const values = rowValues(row);
    if (!hasContent(values)) continue;
    if (rows.length >= MAX_CONTENT_ROWS) return { rows: [], overflow: true };
    rows.push({ row: row.number, values });
  }
  return { rows, overflow: false };
}

/**
 * Hanya worksheet PERTAMA (urutan entri ZIP) yang dibaca; iterasi dihentikan setelahnya. Aman karena
 * ZIP sudah dinormalisasi (xlsx-zip.ts) sehingga exceljs mem-parse langsung dari stream tanpa berkas
 * sementara.
 */
async function streamFirstSheet(bytes: Uint8Array): Promise<SheetResult | null> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from([Buffer.from(bytes)]), XLSX_READER_OPTIONS);
  for await (const sheet of reader) return collectSheet(sheet);
  return null;
}

async function readXlsx(bytes: Uint8Array): Promise<ImportSheet> {
  const guard = checkZipArchive(bytes, IMPORT_MAX_UNCOMPRESSED_BYTES);
  if (!guard.ok) throw fileInvalid(`Berkas XLSX ditolak: ${guard.reason}.`);
  const normalized = normalizeXlsxZip(bytes);
  if (normalized === null) throw fileInvalid("Berkas XLSX rusak atau tidak dapat dibaca.");
  let first: SheetResult | null;
  try {
    first = await streamFirstSheet(normalized);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw fileInvalid("Berkas XLSX rusak atau tidak dapat dibaca.");
  }
  if (first === null) throw fileInvalid("Berkas XLSX tidak memiliki sheet.");
  if (first.overflow) throw tooManyRows();
  return splitHeader(first.rows);
}

function readCsv(bytes: Uint8Array): ImportSheet {
  const text = decodeCsvBytes(bytes);
  if (text === null) throw fileInvalid();
  const parsed = parseCsv(text, { maxColumns: IMPORT_MAX_COLUMNS, maxRows: MAX_CONTENT_ROWS });
  if (parsed.overflow) throw tooManyRows();
  return splitHeader(parsed.records);
}

export async function readImportFile(bytes: Uint8Array): Promise<ImportSheet> {
  if (bytes.length === 0) throw unprocessable("IMPORT_EMPTY", "Berkas kosong.");
  return isZipMagic(bytes) ? readXlsx(bytes) : readCsv(bytes);
}
