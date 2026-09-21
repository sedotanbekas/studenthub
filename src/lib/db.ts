import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { Prisma, PrismaClient } from "@prisma/client";

/**
 * Klien Prisma tunggal (adapter MariaDB). Setiap koneksi memakai time_zone '+00:00' agar
 * DEFAULT CURRENT_TIMESTAMP konsisten dengan instant UTC yang dibaca Prisma.
 */
function createAdapter(): PrismaMariaDb {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL belum diisi");
  const url = new URL(raw);
  return new PrismaMariaDb({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT ?? 10),
    connectTimeout: 20_000,
    acquireTimeout: 20_000,
    initSql: "SET time_zone = '+00:00'",
  });
}

/** PRISMA_LOG="error,warn" (default) atau "" untuk senyap (test). */
function prismaLogLevels(): Array<"error" | "warn" | "info" | "query"> {
  const raw = process.env.PRISMA_LOG;
  if (raw === undefined) return ["error", "warn"];
  return raw
    .split(",")
    .map((level) => level.trim())
    .filter((level): level is "error" | "warn" | "info" | "query" => ["error", "warn", "info", "query"].includes(level));
}

function createClient() {
  return new PrismaClient({
    adapter: createAdapter(),
    log: prismaLogLevels(),
    omit: { user: { passwordHash: true, totpSecretEnc: true } },
  });
}

type Client = ReturnType<typeof createClient>;
const globalForPrisma = globalThis as unknown as { prisma?: Client };

export const prisma: Client = globalForPrisma.prisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export type Db = Client;
/** Klien di dalam transaksi interaktif. */
export type Tx = Omit<Client, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;
export { Prisma };
