import { z } from "zod";

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
    const secrets = [env.JWT_ACCESS_SECRET, env.AD_EVENT_SECRET, env.JOB_SECRET];
    if (new Set(secrets).size !== secrets.length) {
      ctx.addIssue({ code: "custom", message: "JWT_ACCESS_SECRET, AD_EVENT_SECRET, JOB_SECRET harus berbeda" });
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
