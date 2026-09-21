import { parseLocalDate, type LocalDate } from "@/lib/time/zone";
import { NAME_MAX, NAME_MIN, SPP_AMOUNT_MAX, collapseText, isValidNis, isValidNisn, type GenderValue } from "../constants";
import { normalizeIdPhone } from "../phone";

/**
 * Parser sel impor (murni). Nilai sel berasal dari exceljs (string/number/Date/objek rich text,
 * hyperlink, formula) atau CSV (selalu string). Sel kosong -> { value: null } (wajib/tidaknya dicek
 * validator baris). `error`/`warning` berupa pesan Bahasa Indonesia.
 */
export interface CellResult<T> {
  readonly value: T | null;
  readonly error?: string;
  readonly warning?: string;
}

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;
const NISN_LENGTH = 10;
const MAX_NISN_NUMBER = 10 ** NISN_LENGTH;
const SCIENTIFIC = /^\d+(?:\.\d+)?e\+?\d+$/i;

const empty = <T>(): CellResult<T> => ({ value: null });
const fail = <T>(error: string): CellResult<T> => ({ value: null, error });

const isoDate = (date: Date): string => date.toISOString().slice(0, 10);

function objectText(value: object): string | null {
  if ("richText" in value && Array.isArray(value.richText)) {
    return collapseText(value.richText.map((part: { text?: unknown }) => (typeof part.text === "string" ? part.text : "")).join(""));
  }
  if ("error" in value) return null;
  if ("result" in value) return cellText(value.result);
  if ("text" in value) return cellText(value.text);
  return null;
}

/** Teks sel yang sudah dirapikan (spasi berulang & tepi); kosong -> null. */
export function cellText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return collapseText(value);
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value === "boolean") return String(value);
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : isoDate(value);
  if (typeof value === "object") return objectText(value);
  return null;
}

/** Hilangkan apostrof pemaksa-teks Excel di awal sel. */
const stripApostrophe = (text: string): string => text.replace(/^'+/, "").trim();

function nisnFromNumber(value: number): CellResult<string> {
  if (!Number.isInteger(value) || value < 0 || value >= MAX_NISN_NUMBER) return fail("NISN harus 10 digit angka.");
  const digits = String(value);
  const padded = digits.padStart(NISN_LENGTH, "0");
  if (!isValidNisn(padded)) return fail("NISN harus 10 digit angka.");
  if (digits.length === NISN_LENGTH) return { value: padded };
  return { value: padded, warning: "NISN diisi nol di depan hingga 10 digit (sel angka kehilangan nol depan)." };
}

export function parseNisnCell(value: unknown): CellResult<string> {
  if (typeof value === "number") return nisnFromNumber(value);
  const text = cellText(value);
  if (text === null) return empty();
  const clean = stripApostrophe(text);
  if (SCIENTIFIC.test(clean)) return nisnFromNumber(Number(clean));
  return isValidNisn(clean) ? { value: clean } : fail("NISN harus 10 digit angka.");
}

export function parseNisCell(value: unknown): CellResult<string> {
  const text = typeof value === "number" && Number.isInteger(value) ? String(value) : cellText(value);
  if (text === null) return empty();
  const clean = stripApostrophe(text);
  return isValidNis(clean) ? { value: clean } : fail("NIS hanya huruf, angka, titik, garis miring, atau tanda hubung (maks 20).");
}

export function parseNameCell(value: unknown): CellResult<string> {
  const text = cellText(value);
  if (text === null) return empty();
  if (text.length < NAME_MIN || text.length > NAME_MAX) return fail(`Nama lengkap harus ${NAME_MIN}–${NAME_MAX} karakter.`);
  return { value: text };
}

const GENDER_ALIASES: Readonly<Record<string, GenderValue>> = {
  l: "MALE",
  "laki-laki": "MALE",
  "laki laki": "MALE",
  lakilaki: "MALE",
  pria: "MALE",
  m: "MALE",
  male: "MALE",
  p: "FEMALE",
  perempuan: "FEMALE",
  wanita: "FEMALE",
  f: "FEMALE",
  female: "FEMALE",
};

export function parseGenderCell(value: unknown): CellResult<GenderValue> {
  const text = cellText(value);
  if (text === null) return empty();
  const gender = GENDER_ALIASES[text.toLowerCase()];
  return gender ? { value: gender } : fail("Jenis kelamin harus L/P (Laki-laki/Perempuan).");
}

const DMY = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/;
const YMD = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const pad2 = (part: string): string => part.padStart(2, "0");
const INVALID_DATE = "Tanggal lahir tidak valid (format DD/MM/YYYY, DD-MM-YYYY, atau YYYY-MM-DD).";

function dateFromText(text: string): string | null {
  const dmy = DMY.exec(text);
  if (dmy) return `${dmy[3]}-${pad2(dmy[2] as string)}-${pad2(dmy[1] as string)}`;
  const ymd = YMD.exec(text);
  if (ymd) return `${ymd[1]}-${pad2(ymd[2] as string)}-${pad2(ymd[3] as string)}`;
  return null;
}

export function parseDateCell(value: unknown): CellResult<LocalDate> {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? fail(INVALID_DATE) : { value: isoDate(value) };
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 1) return fail(INVALID_DATE);
    return { value: isoDate(new Date(EXCEL_EPOCH_MS + Math.floor(value) * DAY_MS)) };
  }
  const text = cellText(value);
  if (text === null) return empty();
  const candidate = dateFromText(stripApostrophe(text));
  const valid = candidate === null ? null : parseLocalDate(candidate);
  return valid === null ? fail(INVALID_DATE) : { value: valid };
}

function phoneText(value: unknown): string | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    const digits = String(value);
    return digits.startsWith("8") ? `0${digits}` : digits;
  }
  const text = cellText(value);
  return text === null ? null : stripApostrophe(text);
}

export function parsePhoneCell(value: unknown): CellResult<string> {
  const text = phoneText(value);
  if (text === null || text === "") return empty();
  const phone = normalizeIdPhone(text);
  return phone ? { value: phone } : fail("Nomor HP wali tidak valid (contoh 081234567890).");
}

const SPP_ERROR = `SPP harus bilangan bulat rupiah 0–${SPP_AMOUNT_MAX.toLocaleString("id-ID")}.`;

export function parseSppCell(value: unknown): CellResult<number> {
  let amount: number;
  if (typeof value === "number") {
    amount = value;
  } else {
    const text = cellText(value);
    if (text === null) return empty();
    const digits = text.replace(/^rp\.?/i, "").replace(/\s/g, "").replace(/[,.]00$/, "").replace(/[.,]/g, "");
    if (!/^\d+$/.test(digits)) return fail(SPP_ERROR);
    amount = Number(digits);
  }
  if (!Number.isInteger(amount) || amount < 0 || amount > SPP_AMOUNT_MAX) return fail(SPP_ERROR);
  return { value: amount };
}

export function parseTextCell(value: unknown, max: number, label: string): CellResult<string> {
  const text = cellText(value);
  if (text === null) return empty();
  return text.length > max ? fail(`${label} maksimal ${max} karakter.`) : { value: text };
}

/** Nama kelas ternormalisasi untuk pencocokan: huruf besar, spasi dirapikan. */
export function normalizeClassName(value: string): string {
  return value.replace(/\s+/g, " ").trim().toUpperCase();
}
