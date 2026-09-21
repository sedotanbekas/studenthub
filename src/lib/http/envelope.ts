/** Envelope respons JSON tunggal untuk seluruh API. */
export type PageMeta = { total: number; page: number; limit: number; totalPages: number };
export type CursorMeta = { limit: number; nextCursor: string | null; hasMore: boolean };
export type Meta = PageMeta | CursorMeta | Record<string, unknown>;

export type ErrorBody = { code: string; message: string; details: unknown; requestId: string | null };
export type SuccessEnvelope<T> = { success: true; data: T; error: null; meta: Meta | null };
export type ErrorEnvelope = { success: false; data: null; error: ErrorBody; meta: null };

export function ok<T>(data: T, meta?: Meta | null): SuccessEnvelope<T> {
  return { success: true, data, error: null, meta: meta ?? null };
}

export function fail(code: string, message: string, details?: unknown, requestId?: string | null): ErrorEnvelope {
  return { success: false, data: null, error: { code, message, details: details ?? null, requestId: requestId ?? null }, meta: null };
}

export function pageMeta(total: number, page: number, limit: number): PageMeta {
  return { total, page, limit, totalPages: total === 0 ? 0 : Math.ceil(total / limit) };
}
