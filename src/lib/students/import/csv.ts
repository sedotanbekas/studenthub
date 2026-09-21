/**
 * Pembaca CSV sederhana (murni, RFC 4180): kutip ganda, "" sebagai escape, baris baru di dalam kutip,
 * CRLF/LF/CR. Pemisah `,` atau `;` dideteksi dari baris pertama (Excel berlokal Indonesia memakai `;`).
 */
export type CsvDelimiter = "," | ";";

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
  rows: string[][];
  row: string[];
  field: string;
  quoted: boolean;
}

function endRow(state: CsvState): void {
  state.row.push(state.field);
  state.rows.push(state.row);
  state.row = [];
  state.field = "";
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
    state.row.push(state.field);
    state.field = "";
  } else if (char === "\r" || char === "\n") {
    endRow(state);
    return char === "\r" && next === "\n" ? 2 : 1;
  } else {
    state.field += char;
  }
  return 1;
}

export function parseCsv(text: string, delimiter: CsvDelimiter = detectDelimiter(firstLineOf(text))): string[][] {
  const state: CsvState = { rows: [], row: [], field: "", quoted: false };
  let i = 0;
  while (i < text.length) {
    const char = text[i] as string;
    const next = text[i + 1];
    i += state.quoted ? stepQuoted(state, char, next) : stepPlain(state, char, next, delimiter);
  }
  if (state.field !== "" || state.row.length > 0) endRow(state);
  return state.rows;
}
