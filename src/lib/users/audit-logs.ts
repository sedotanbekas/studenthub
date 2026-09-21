import type { Prisma } from "@prisma/client";
import { redactForAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { notFound } from "@/lib/http/errors";
import { toSkipTake } from "@/lib/http/pagination";
import type { SchoolScope } from "@/lib/tenant/scope";
import type { AuditLogDto, AuditQuery } from "./audit-schemas";

/**
 * Daftar log audit (terbaru dulu, limit <= 100). SUPER_ADMIN: semua sekolah lewat /platform/audit-logs.
 * Admin sekolah: hanya sekolahnya sendiri lewat /school/audit-logs (scope dipaksa resolveSchoolScope).
 */
function auditWhere(query: AuditQuery, schoolId: string | undefined): Prisma.AuditLogWhereInput {
  const createdAt = {
    ...(query.from ? { gte: new Date(query.from) } : {}),
    ...(query.to ? { lte: new Date(query.to) } : {}),
  };
  return {
    ...(schoolId ? { schoolId } : {}),
    ...(query.actorId ? { actorId: query.actorId } : {}),
    ...(query.entityType ? { entityType: query.entityType } : {}),
    ...(query.entityId ? { entityId: query.entityId } : {}),
    ...(query.action ? { action: query.action } : {}),
    ...(Object.keys(createdAt).length > 0 ? { createdAt } : {}),
  };
}

async function findAuditLogs(where: Prisma.AuditLogWhereInput, query: AuditQuery): Promise<{ items: AuditLogDto[]; total: number }> {
  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...toSkipTake(query),
      include: { actor: { select: { id: true, name: true, role: true } } },
    }),
  ]);
  const items = rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    actor: row.actor ? { id: row.actor.id, name: row.actor.name, role: row.actor.role } : null,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    // Pertahanan berlapis: redaksi ulang saat dibaca (baris lama/ditulis di luar writeAudit).
    before: redactForAudit(row.before ?? null),
    after: redactForAudit(row.after ?? null),
    ipAddress: row.ipAddress,
  }));
  return { items, total };
}

export async function listPlatformAuditLogs(query: AuditQuery): Promise<{ items: AuditLogDto[]; total: number }> {
  return findAuditLogs(auditWhere(query, query.schoolId), query);
}

/** Log audit satu sekolah; SUPER_ADMIN dengan schoolId yang tidak ada -> 404. */
export async function listSchoolAuditLogs(scope: SchoolScope, query: AuditQuery): Promise<{ items: AuditLogDto[]; total: number }> {
  const school = await prisma.school.findUnique({ where: { id: scope.schoolId }, select: { id: true } });
  if (!school) throw notFound("Sekolah tidak ditemukan.");
  return findAuditLogs(auditWhere(query, scope.schoolId), query);
}
