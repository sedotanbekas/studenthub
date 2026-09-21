/**
 * Nomor dokumen SPP (murni): INV-YYYY-NNNNNN (tagihan) & KWT-YYYY-NNNNNN (kuitansi). Urutan dari
 * DocumentCounter per (sekolah, jenis, tahun lokal); lebih dari 999999 cukup melebar.
 */
export type DocumentKindValue = "INVOICE" | "RECEIPT";

export const KIND_PREFIX: Readonly<Record<DocumentKindValue, string>> = Object.freeze({ INVOICE: "INV", RECEIPT: "KWT" });

const SEQ_WIDTH = 6;
const PATTERN = /^(INV|KWT)-(\d{4})-(\d{6,})$/;

export interface DocumentNumber {
  readonly kind: DocumentKindValue;
  readonly year: number;
  readonly seq: number;
}

export function formatDocumentNumber(kind: DocumentKindValue, year: number, seq: number): string {
  if (!Number.isSafeInteger(seq) || seq < 1) throw new RangeError(`Nomor urut dokumen tidak valid: ${seq}`);
  if (!Number.isInteger(year) || year < 1000 || year > 9999) throw new RangeError(`Tahun dokumen tidak valid: ${year}`);
  return `${KIND_PREFIX[kind]}-${year}-${String(seq).padStart(SEQ_WIDTH, "0")}`;
}

export function parseDocumentNumber(text: string): DocumentNumber | null {
  const match = PATTERN.exec(text);
  if (!match) return null;
  const [, prefix, year, seq] = match;
  const kind: DocumentKindValue = prefix === "INV" ? "INVOICE" : "RECEIPT";
  const value = Number(seq);
  if (value < 1 || !Number.isSafeInteger(value)) return null;
  // Tanpa nol di depan yang berlebih: "0000001" (7 digit) bukan bentuk kanonik.
  if (String(seq).length > SEQ_WIDTH && String(seq).startsWith("0")) return null;
  return { kind, year: Number(year), seq: value };
}

/** Nomor berurutan first..first+count-1. */
export function documentNumberRange(kind: DocumentKindValue, year: number, first: number, count: number): string[] {
  return Array.from({ length: count }, (_, i) => formatDocumentNumber(kind, year, first + i));
}
