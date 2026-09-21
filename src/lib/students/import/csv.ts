/**
 * Pembaca CSV sederhana (murni, RFC 4180): kutip ganda, "" sebagai escape, baris baru di dalam kutip,
 * CRLF/LF/CR. Pemisah `,` atau `;` dideteksi dari baris pertama (Excel berlokal Indonesia memakai `;`).
 * Berbatas: kolom per baris dipotong `maxColumns`, dan parsing BERHENTI begitu jumlah baris berisi
 * melewati `maxRows` (`overflow`), sehingga berkas raksasa tidak pernah diurai seluruhnya.
 */
export type CsvDelimiter = "," | ";";

export interface CsvLimits {
  readonly maxColumns: number;
  /** Batas baris BERISI (baris kosong tidak dihitung). */
  readonly maxRows: number;
}

export interface CsvRecord {
  /** Nomor baris (record) 1-based, termasuk baris kosong yang dilewati. */
  readonly row: number;
  readonly values: readonly string[];
}

export interface CsvParseResult {
  readonly records: readonly CsvRecord[];
  /** true bila parsing dihentikan karena baris berisi > maxRows. */
  readonly overflow: boolean;
}

/** UTF-8 (BOM dibuang); bila bukan UTF-8 sah, fallback windows-1252. Byte NUL = biner -> null. */
export function decodeCsvBytes(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("windows-1252").decode(bytes);
  }
  return text.startsWith("﻿") ? text.slice(1) : text;
}

export function detectDelimiter(firstLine: string): CsvDelimiter {
  let commas = 0;
  let semicolons = 0;
  let quoted = false;
  for (const char of firstLine) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === ",") commas += 1;
    else if (!quoted && char === ";") semicolons += 1;
  }
  return semicolons > commas ? ";" : ",";
}

const firstLineOf = (text: string): string => text.split(/\r\n|\n|\r/, 1)[0] ?? "";

interface CsvState {
  readonly records: CsvRecord[];
  readonly limits: CsvLimits;
  row: string[];
  field: string;
  quoted: boolean;
  rowNumber: number;
  overflow: boolean;
}

const hasContent = (values: readonly string[]): boolean => values.some((value) => value.trim() !== "");

function endField(state: CsvState): void {
  if (state.row.length < state.limits.maxColumns) state.row.push(state.field);
  state.field = "";
}

function endRow(state: CsvState): void {
  endField(state);
  state.rowNumber += 1;
  if (hasContent(state.row)) {
    state.records.push({ row: state.rowNumber, values: state.row });
    if (state.records.length > state.limits.maxRows) state.overflow = true;
  }
  state.row = [];
}

function stepQuoted(state: CsvState, char: string, next: string | undefined): number {
  if (char !== '"') {
    state.field += char;
    return 1;
  }
  if (next === '"') {
    state.field += '"';
    return 2;
  }
  state.quoted = false;
  return 1;
}

function stepPlain(state: CsvState, char: string, next: string | undefined, delimiter: CsvDelimiter): number {
  if (char === '"' && state.field === "") {
    state.quoted = true;
  } else if (char === delimiter) {
    endField(state);
  } else if (char === "\r" || char === "\n") {
    endRow(state);
    return char === "\r" && next === "\n" ? 2 : 1;
  } else {
    state.field += char;
  }
  return 1;
}

export function parseCsv(text: string, limits: CsvLimits, delimiter: CsvDelimiter = detectDelimiter(firstLineOf(text))): CsvParseResult {
  const state: CsvState = { records: [], limits, row: [], field: "", quoted: false, rowNumber: 0, overflow: false };
  let i = 0;
  while (i < text.length && !state.overflow) {
    const char = text[i] as string;
    const next = text[i + 1];
    i += state.quoted ? stepQuoted(state, char, next) : stepPlain(state, char, next, delimiter);
  }
  if (!state.overflow && (state.field !== "" || state.row.length > 0)) endRow(state);
  return { records: state.records, overflow: state.overflow };
}
