/**
 * Satu kelas error aplikasi untuk semua domain. Service melempar AppError; defineRoute
 * menerjemahkannya ke envelope `{success:false, error:{code,message,details,requestId}}`.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (code: string, message: string, details?: unknown) => new AppError(400, code, message, details);
export const unauthorized = (code: string, message: string) => new AppError(401, code, message);
export const forbidden = (code: string, message: string, details?: unknown) => new AppError(403, code, message, details);
export const notFound = (message = "Data tidak ditemukan.", code = "NOT_FOUND") => new AppError(404, code, message);
export const conflict = (code: string, message: string, details?: unknown) => new AppError(409, code, message, details);
export const gone = (code: string, message: string) => new AppError(410, code, message);
export const unprocessable = (code: string, message: string, details?: unknown) => new AppError(422, code, message, details);
export const tooManyRequests = (retryAfterSeconds: number, message = "Terlalu banyak percobaan. Coba lagi nanti.") =>
  new AppError(429, "RATE_LIMITED", message, { retryAfterSeconds }, { "Retry-After": String(retryAfterSeconds) });
export const serviceUnavailable = (message = "Layanan sedang tidak tersedia.") => new AppError(503, "SERVICE_UNAVAILABLE", message);

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
