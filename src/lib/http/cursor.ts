import { z } from "zod";
import { badRequest, type AppError } from "./errors";

/**
 * Paginasi cursor untuk feed (inbox, riwayat). Cursor = base64url dari JSON `{t: ISO createdAt, id}`.
 * Service mengurutkan `createdAt desc, id desc`, memfilter dengan `cursorWhere(...)` digabung lewat
 * `AND` (jangan di-spread: bisa menimpa `OR` milik filter lain), mengambil `limit + 1` baris, lalu
 * memanggil `sliceCursorPage(rows, limit)`.
 */
export const CURSOR_DEFAULT_LIMIT = 20;
export const CURSOR_MAX_LIMIT = 50;
export const CURSOR_MAX_LENGTH = 200;

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const PAYLOAD_KEYS = 2;

export type CursorPosition = { readonly createdAt: Date; readonly id: string };

export type CursorWhere = {
  OR?: [{ createdAt: { lt: Date } }, { createdAt: Date; id: { lt: string } }];
};

export type CursorPage<T> = { items: T[]; nextCursor: string | null; hasMore: boolean };

export const cursorQuerySchema = z.object({
  cursor: z
    .string()
    .max(CURSOR_MAX_LENGTH, `cursor maksimal ${CURSOR_MAX_LENGTH} karakter.`)
    .optional()
    .meta({ description: "Cursor opak dari `meta.nextCursor` halaman sebelumnya; kosongkan untuk halaman pertama." }),
  limit: z.coerce
    .number({ error: "limit harus berupa angka." })
    .int("limit harus bilangan bulat.")
    .min(1, "limit minimal 1.")
    .max(CURSOR_MAX_LIMIT, `limit maksimal ${CURSOR_MAX_LIMIT}.`)
    .default(CURSOR_DEFAULT_LIMIT)
    .meta({ description: `Jumlah item per halaman (maks ${CURSOR_MAX_LIMIT}).`, example: CURSOR_DEFAULT_LIMIT }),
});

export type CursorQuery = z.infer<typeof cursorQuerySchema>;

function invalidCursor(): AppError {
  return badRequest("INVALID_CURSOR", "Cursor tidak valid.");
}

export function encodeCursor(position: CursorPosition): string {
  const payload = JSON.stringify({ t: position.createdAt.toISOString(), id: position.id });
  return Buffer.from(payload, "utf8").toString("base64url");
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw invalidCursor();
  }
}

function toPosition(payload: unknown): CursorPosition {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw invalidCursor();
  if (Object.keys(payload).length !== PAYLOAD_KEYS) throw invalidCursor();
  const { t, id } = payload as Record<string, unknown>;
  if (typeof t !== "string" || typeof id !== "string" || !ID_RE.test(id)) throw invalidCursor();
  const createdAt = new Date(t);
  // Round-trip ketat: hanya format persis keluaran toISOString() yang diterima.
  if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== t) throw invalidCursor();
  return { createdAt, id };
}

/** Dekode cursor; melempar 400 `INVALID_CURSOR` untuk bentuk apa pun yang tidak sah. */
export function decodeCursor(value: string): CursorPosition {
  if (value.length === 0 || value.length > CURSOR_MAX_LENGTH || !BASE64URL_RE.test(value)) throw invalidCursor();
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value) throw invalidCursor();
  return toPosition(parseJson(bytes.toString("utf8")));
}

/** Cursor opsional dari query: `undefined`/string kosong berarti halaman pertama (`null`). */
export function decodeOptionalCursor(value: string | undefined): CursorPosition | null {
  return value === undefined || value === "" ? null : decodeCursor(value);
}

/** Filter "setelah cursor" untuk urutan `createdAt desc, id desc`. */
export function cursorWhere(cursor: CursorPosition | null): CursorWhere {
  if (cursor === null) return {};
  return { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] };
}

/** Memotong hasil `limit + 1` baris menjadi satu halaman + cursor berikutnya. */
export function sliceCursorPage<T extends { createdAt: Date; id: string }>(rows: readonly T[], limit: number): CursorPage<T> {
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  const nextCursor = hasMore && last !== undefined ? encodeCursor(last) : null;
  return { items, nextCursor, hasMore };
}
