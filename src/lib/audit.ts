import type { Prisma } from "@prisma/client";
import type { Tx } from "./db";
import type { ActionContext } from "./auth/principal";

/** Entri audit; before/after diredaksi otomatis (tanpa password/hash/token/secret). */
export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string;
  schoolId?: string | null;
  before?: unknown;
  after?: unknown;
}

const SECRET_KEY = /password|hash|token|secret|totp/i;
const MAX_DEPTH = 8;

/** Salinan dalam tanpa kunci rahasia; Date -> ISO, bigint -> string. Tidak memutasi input. */
export function redactForAudit(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[terlalu dalam]";
  if (value === null || value === undefined) return value ?? null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((item) => redactForAudit(item, depth + 1));
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !SECRET_KEY.test(key))
      .map(([key, inner]) => [key, redactForAudit(inner, depth + 1)] as const);
    return Object.fromEntries(entries);
  }
  if (typeof value === "string" && value.length > 2000) return `${value.slice(0, 2000)}...`;
  return value;
}

type AuditActor = Pick<ActionContext, "principal" | "ip" | "userAgent">;

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return redactForAudit(value) as Prisma.InputJsonValue;
}

/** Tulis audit DI DALAM transaksi yang sama dengan perubahan datanya. */
export async function writeAudit(tx: Tx, entry: AuditEntry, ctx: AuditActor): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId: ctx.principal?.userId ?? null,
      actorRole: ctx.principal?.role ?? null,
      schoolId: entry.schoolId ?? null,
      action: entry.action.slice(0, 64),
      entityType: entry.entityType.slice(0, 40),
      entityId: entry.entityId.slice(0, 191),
      before: toJson(entry.before),
      after: toJson(entry.after),
      ipAddress: ctx.ip?.slice(0, 45) ?? null,
      userAgent: ctx.userAgent?.slice(0, 255) ?? null,
    },
  });
}
