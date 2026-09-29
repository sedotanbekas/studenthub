import { number, rupiah } from "./format";
import type { Schema } from "./types";

/**
 * Aturan murni isian angka di formulir web: nominal rupiah, nomor HP, deret digit (NISN, rekening, kode),
 * bilangan bulat, dan desimal. Karakter selain angka dibuang saat diketik/ditempel, bukan ditolak saat kirim.
 */
export type NumericKind = "money" | "phone" | "digits" | "integer" | "decimal";

export interface NumericSpec {
  readonly kind: NumericKind;
  /** Boleh negatif (tanda "-" di depan), mis. penyesuaian saldo atau koordinat. */
  readonly signed: boolean;
  /** Dikirim sebagai string digit (nomor HP, NISN, nominal multipart), bukan number. */
  readonly asString: boolean;
  readonly maxDigits?: number;
  /** Panjang digit wajib tepat (NISN 10, NPSN 8, kode TOTP 6). */
  readonly exactDigits?: number;
}

export type NumericValue = string | number | undefined;

const PHONE_MAX_DIGITS = 15;
const AMOUNT_MAX_DIGITS = 9;
const INTEGER_MAX_DIGITS = 15;
const MONEY_NAME = /amount|price|budget|cpc|^spp/i;
const PHONE_NAME = /phone/i;
/** Pola kontrak yang murni digit: ^\d{6}$ atau ^\d{1,9}$. */
const DIGIT_PATTERN = /^\^\\d\{(\d+)(?:,(\d+))?\}\$$/;
const DIGIT_FIELDS: Readonly<Record<string, { readonly max: number; readonly exact?: boolean }>> = {
  nisn: { max: 10, exact: true },
  npsn: { max: 8, exact: true },
  totpCode: { max: 6, exact: true },
  bankAccountNumber: { max: 30 },
  topUpAccountNumber: { max: 30 },
};

/** Batas negatif yang nyata; batas bawaan z.int() (-2^53+1) bukan izin memasukkan minus. */
const isRealBound = (value?: number): value is number => value !== undefined && Math.abs(value) < Number.MAX_SAFE_INTEGER;
const allowsNegative = (minimum?: number): boolean => isRealBound(minimum) && minimum < 0;

/** Jenis isian angka untuk field `name`; null = bukan isian angka (teks bebas). `type` = tipe non-null skema. */
export function numericSpec(name: string, schema: Schema, type: string | undefined): NumericSpec | null {
  const isNumber = type === "integer" || type === "number";
  const digitPattern = type === "string" && schema.pattern ? DIGIT_PATTERN.exec(schema.pattern) : null;
  if (type === "string" && PHONE_NAME.test(name)) return { kind: "phone", signed: false, asString: true, maxDigits: PHONE_MAX_DIGITS };
  if (MONEY_NAME.test(name) && (isNumber || digitPattern)) {
    return { kind: "money", signed: isNumber && allowsNegative(schema.minimum), asString: !isNumber, maxDigits: AMOUNT_MAX_DIGITS };
  }
  const known = DIGIT_FIELDS[name];
  if (type === "string" && known) return { kind: "digits", signed: false, asString: true, maxDigits: known.max, exactDigits: known.exact ? known.max : undefined };
  if (digitPattern) {
    const min = Number(digitPattern[1]);
    const max = digitPattern[2] === undefined ? min : Number(digitPattern[2]);
    return { kind: "digits", signed: false, asString: true, maxDigits: max, exactDigits: min === max ? min : undefined };
  }
  if (type === "integer") return { kind: "integer", signed: allowsNegative(schema.minimum), asString: false };
  if (type === "number") return { kind: "decimal", signed: schema.minimum === undefined || allowsNegative(schema.minimum), asString: false };
  return null;
}

const onlyDigits = (text: string): string => text.replace(/\D/g, "");
/**
 * Bagian desimal di akhir nominal tempelan: ",00" / ",-" (format Indonesia) atau ".00" setelah ribuan
 * berkoma ("500,000.00"). Titik tanpa koma selalu pemisah ribuan (kolom sendiri memformat "500.000").
 */
const stripDecimals = (text: string): string => text.trim().replace(/,(?:\d{1,2}|-)?$/, "").replace(/(,\d{3})\.\d{1,2}$/, "$1");
/** Isi kolom nominal -> digit saja (tanpa desimal, tanpa nol di depan, maks 9 digit sesuai kontrak). */
export const amountDigits = (text: string): string => stripDecimals(text).replace(/\D/g, "").replace(/^0+/, "").slice(0, AMOUNT_MAX_DIGITS);
export const formatAmountInput = (digits: string): string => (digits ? number(Number(digits)) : "");

function decimalText(text: string): string {
  const [whole = "", ...fraction] = text.replace(/,/g, ".").replace(/[^\d.]/g, "").split(".");
  return fraction.length > 0 ? `${whole}.${fraction.join("")}` : whole;
}

/** Teks ketikan/tempelan -> teks yang boleh tampil: digit saja, plus "-" di depan / satu "." sesuai jenis. */
export function sanitizeNumeric(text: string, spec: NumericSpec): string {
  const sign = spec.signed && text.trim().startsWith("-") ? "-" : "";
  switch (spec.kind) {
    case "money": {
      const digits = amountDigits(text);
      // "0" = nilai sah (mis. bebas SPP); amountDigits membuang nol di depan sehingga "0" menjadi kosong.
      return sign + (digits === "" && /^\s*-?\s*0+\s*$/.test(text) ? "0" : digits);
    }
    case "phone":
    case "digits":
      return onlyDigits(text).slice(0, spec.maxDigits);
    case "integer":
      return sign + onlyDigits(text).replace(/^0+(?=\d)/, "").slice(0, INTEGER_MAX_DIGITS);
    case "decimal":
      return sign + decimalText(text);
  }
}

/** Teks tersanitasi -> nilai request; undefined = kosong atau belum lengkap ("-"). */
export function parseNumeric(text: string, spec: NumericSpec): NumericValue {
  if (text === "" || text === "-") return undefined;
  if (spec.asString) return text;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

/** Nilai tersimpan (number / "+62…" / null) -> teks draf isian. */
export function numericDraft(value: unknown, spec: NumericSpec): string {
  if (value === undefined || value === null || value === "") return "";
  return sanitizeNumeric(String(value), spec);
}

/** Draf -> teks di layar: nominal diberi pemisah ribuan ("555.555"), lainnya apa adanya. */
export function displayNumeric(draft: string, spec: NumericSpec): string {
  if (spec.kind !== "money") return draft;
  const negative = draft.startsWith("-");
  const digits = negative ? draft.slice(1) : draft;
  return `${negative ? "-" : ""}${digits === "0" ? "0" : formatAmountInput(digits)}`;
}

/** Pesan validasi (setCustomValidity); "" = sah. Isian kosong diurus atribut `required`. */
export function rangeProblem(value: NumericValue, spec: NumericSpec, bounds: Pick<Schema, "minimum" | "maximum">): string {
  if (spec.exactDigits !== undefined && typeof value === "string" && value.length !== spec.exactDigits) return `Harus ${spec.exactDigits} digit angka.`;
  if (typeof value !== "number") return "";
  const format = (n: number): string => (spec.kind === "money" ? rupiah(n) : String(n));
  if (isRealBound(bounds.minimum) && value < bounds.minimum) return `Minimal ${format(bounds.minimum)}.`;
  if (isRealBound(bounds.maximum) && value > bounds.maximum) return `Maksimal ${format(bounds.maximum)}.`;
  return "";
}

/** Keyboard HP: papan angka; desimal tanpa minus = papan desimal; bertanda = teks (papan iOS tanpa tombol minus). */
export function inputModeFor(spec: NumericSpec): "numeric" | "decimal" | "text" {
  if (spec.signed) return "text";
  return spec.kind === "decimal" ? "decimal" : "numeric";
}
