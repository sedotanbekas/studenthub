/**
 * Logger JSON satu baris. Satu-satunya tempat `console.*` diizinkan di src/.
 * JANGAN pernah melog body request, token, password, atau pesan error Prisma mentah (PII).
 */
type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const level = (process.env.LOG_LEVEL as Level | undefined) ?? "info";
  return ORDER[level] ?? ORDER.info;
}

function write(level: Level, message: string, fields?: Record<string, unknown>): void {
  if (ORDER[level] < threshold()) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg: message, ...fields });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const log = {
  debug: (message: string, fields?: Record<string, unknown>) => write("debug", message, fields),
  info: (message: string, fields?: Record<string, unknown>) => write("info", message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => write("warn", message, fields),
  error: (message: string, fields?: Record<string, unknown>) => write("error", message, fields),
};

/** Ringkasan error yang aman dilog: nama, kode, dan stack tanpa pesan (pesan Prisma bisa memuat data). */
export function safeErrorFields(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    const meta = (error as { meta?: { target?: unknown; constraint?: unknown } }).meta;
    return {
      errName: error.name,
      errCode: typeof code === "string" || typeof code === "number" ? code : undefined,
      errTarget: meta?.target ?? meta?.constraint,
      stack: error.stack?.split("\n").slice(1, 6).join("\n"),
    };
  }
  return { errName: typeof error };
}
