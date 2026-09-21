import { AppError, badRequest } from "./errors";

/**
 * Pembacaan body request yang aman:
 * - JSON: Content-Type wajib `application/json` (415), Content-Length > batas → 413 sebelum membaca,
 *   stream dibaca dengan hitungan byte berjalan (Content-Length bisa bohong/tidak ada) → 413,
 *   body kosong → `{}`, JSON/UTF-8 rusak → 400 `INVALID_JSON`.
 * - Multipart: Content-Type wajib `multipart/form-data` (415), Content-Length WAJIB (411) dan ≤ batas
 *   (413) SEBELUM parsing; byte tetap dihitung saat dibaca, lalu diparse dari buffer terbatas.
 * nginx juga membatasi `client_max_body_size`; route handler Next 16 tidak punya batas sendiri.
 */
export const JSON_BODY_MAX_BYTES = 262_144;
export const MAX_MULTIPART_BYTES = 10_485_760;

export type FormValue = string | File;
export type FormObject = Record<string, FormValue | FormValue[]>;

const CONTENT_LENGTH_RE = /^\d{1,15}$/;

function mediaTypeOf(contentType: string | null): string | null {
  if (contentType === null) return null;
  return (contentType.split(";")[0] ?? "").trim().toLowerCase();
}

function unsupportedMediaType(expected: string): AppError {
  return new AppError(415, "UNSUPPORTED_MEDIA_TYPE", `Content-Type harus ${expected}.`, { expected });
}

function payloadTooLarge(maxBytes: number): AppError {
  return new AppError(413, "PAYLOAD_TOO_LARGE", `Ukuran body melebihi batas ${maxBytes} byte.`, { maxBytes });
}

function invalidJson(): AppError {
  return badRequest("INVALID_JSON", "Body JSON tidak valid.");
}

/** Nilai Content-Length; `null` bila tidak ada atau bukan bilangan bulat non-negatif yang sah. */
function declaredLength(req: Request): number | null {
  const raw = req.headers.get("content-length")?.trim();
  return raw !== undefined && CONTENT_LENGTH_RE.test(raw) ? Number(raw) : null;
}

function concatChunks(chunks: readonly Uint8Array[], total: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(total);
  chunks.reduce((offset, chunk) => {
    out.set(chunk, offset);
    return offset + chunk.byteLength;
  }, 0);
  return out;
}

/** Membaca stream body dengan hitungan byte berjalan; berhenti dengan 413 begitu melewati batas. */
async function readLimitedBytes(req: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  if (req.body === null) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      // Kegagalan cancel tidak relevan: request tetap ditolak 413.
      await reader.cancel().catch(() => undefined);
      throw payloadTooLarge(maxBytes);
    }
    chunks.push(value);
  }
  return concatChunks(chunks, total);
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw invalidJson();
  }
}

function parseJsonText(text: string): unknown {
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    throw invalidJson();
  }
}

export async function readJsonBody(req: Request, maxBytes: number = JSON_BODY_MAX_BYTES): Promise<unknown> {
  if (mediaTypeOf(req.headers.get("content-type")) !== "application/json") {
    throw unsupportedMediaType("application/json");
  }
  const declared = declaredLength(req);
  if (declared !== null && declared > maxBytes) throw payloadTooLarge(maxBytes);
  const bytes = await readLimitedBytes(req, maxBytes);
  return parseJsonText(decodeUtf8(bytes));
}

export async function readMultipart(req: Request, maxBytes: number = MAX_MULTIPART_BYTES): Promise<FormData> {
  const contentType = req.headers.get("content-type");
  if (contentType === null || mediaTypeOf(contentType) !== "multipart/form-data") {
    throw unsupportedMediaType("multipart/form-data");
  }
  const declared = declaredLength(req);
  if (declared === null) {
    throw new AppError(411, "LENGTH_REQUIRED", "Header Content-Length wajib untuk unggahan multipart.");
  }
  if (declared > maxBytes) throw payloadTooLarge(maxBytes);
  const bytes = await readLimitedBytes(req, maxBytes);
  try {
    return await new Response(bytes, { headers: { "content-type": contentType } }).formData();
  } catch {
    throw badRequest("INVALID_MULTIPART", "Body multipart tidak valid.");
  }
}

/**
 * FormData → objek biasa untuk validasi zod. Kunci berulang menjadi array; kunci tunggal tetap skalar.
 * `Object.fromEntries` membuat properti sendiri, sehingga kunci `__proto__` tidak mencemari prototype.
 */
export function formDataToObject(fd: FormData): FormObject {
  // Akumulator lokal O(n) — spread per entri menjadi O(n²) untuk kunci berulang yang banyak.
  const grouped = new Map<string, FormValue[]>();
  for (const [key, value] of fd.entries()) {
    const existing = grouped.get(key);
    if (existing === undefined) grouped.set(key, [value]);
    else existing.push(value);
  }
  return Object.fromEntries(
    [...grouped].map(([key, values]): [string, FormValue | FormValue[]] => {
      const [first, ...rest] = values;
      return [key, rest.length === 0 && first !== undefined ? first : values];
    }),
  );
}
