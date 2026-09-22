import { z } from "zod";
import { parseTotpKey } from "./auth/totp-crypto";

/**
 * Konfigurasi lingkungan tervalidasi. Dibaca malas (getEnv) agar `next build` tidak membutuhkan
 * rahasia produksi. Proses gagal cepat saat pertama kali env dipakai bila konfigurasi tidak valid.
 */
const secret = (name: string) =>
  z.string({ error: `${name} wajib diisi` }).min(32, `${name} minimal 32 karakter`);

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().startsWith("mysql://", "DATABASE_URL harus berskema mysql://"),
    JWT_ACCESS_SECRET: secret("JWT_ACCESS_SECRET"),
    AD_EVENT_SECRET: secret("AD_EVENT_SECRET"),
    JOB_SECRET: secret("JOB_SECRET"),
    /** Kunci AES-256-GCM rahasia TOTP super admin: 32 byte (hex 64 karakter atau base64). */
    TOTP_ENC_KEY: z
      .string({ error: "TOTP_ENC_KEY wajib diisi" })
      .trim()
      .refine((v) => parseTotpKey(v) !== null, "TOTP_ENC_KEY harus 32 byte: hex 64 karakter (openssl rand -hex 32) atau base64"),
    APP_ORIGIN: z.url().transform((v) => v.replace(/\/+$/, "")),
    PUBLIC_MEDIA_BASE_URL: z.url().transform((v) => v.replace(/\/+$/, "")),
    STORAGE_ROOT: z.string().min(1),
    PUSH_TRANSPORT: z.enum(["log", "memory", "expo"]).default("log"),
    EXPO_ACCESS_TOKEN: z.string().optional().transform((v) => (v ? v : undefined)),
    DOCS_BASIC_AUTH: z
      .string()
      .optional()
      .transform((v) => (v ? v : undefined))
      .refine((v) => v === undefined || /^[^:]+:.{8,}$/.test(v), "DOCS_BASIC_AUTH harus user:password (password >= 8)"),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    APP_VERSION: z.string().default("dev"),
    DEFER_MODE: z.enum(["after", "inline"]).default("after"),
  })
  .superRefine((env, ctx) => {
    const secrets = [env.JWT_ACCESS_SECRET, env.AD_EVENT_SECRET, env.JOB_SECRET, env.TOTP_ENC_KEY];
    if (new Set(secrets).size !== secrets.length) {
      ctx.addIssue({ code: "custom", message: "JWT_ACCESS_SECRET, AD_EVENT_SECRET, JOB_SECRET, TOTP_ENC_KEY harus berbeda" });
    }
    if (env.NODE_ENV === "production" && !env.DOCS_BASIC_AUTH) {
      ctx.addIssue({ code: "custom", message: "DOCS_BASIC_AUTH wajib di produksi" });
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `- ${i.path.join(".") || "env"}: ${i.message}`).join("\n");
    throw new Error(`Konfigurasi lingkungan tidak valid:\n${issues}`);
  }
  return result.data;
}

export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** Hanya untuk test: paksa env dibaca ulang. */
export function resetEnvCache(): void {
  cached = undefined;
}
