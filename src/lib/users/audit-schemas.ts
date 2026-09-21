import { z } from "zod";
import { pageQuerySchema } from "@/lib/http/pagination";
import { userRoleSchema } from "./schemas";

/** Skema zod daftar log audit (tanpa impor Prisma: dipakai registry OpenAPI). */
const idString = z.string().trim().min(1).max(191);
const isoInstant = z.iso.datetime({ offset: true, error: "Waktu harus ISO 8601, mis. 2026-09-21T00:00:00Z." });

const filterShape = {
  actorId: idString.optional().meta({ description: "ID pengguna pelaku." }),
  entityType: z.string().trim().min(1).max(40).optional().meta({ example: "School" }),
  entityId: idString.optional(),
  action: z.string().trim().min(1).max(64).optional().meta({ example: "school.update" }),
  from: isoInstant.optional().meta({ description: "Batas bawah createdAt (inklusif)." }),
  to: isoInstant.optional().meta({ description: "Batas atas createdAt (inklusif)." }),
};

const rangeOk = (value: { from?: string; to?: string }): boolean => !value.from || !value.to || Date.parse(value.from) <= Date.parse(value.to);
const RANGE_ERROR = { message: "from harus sebelum atau sama dengan to.", path: ["from"] };

export const platformAuditQuery = pageQuerySchema
  .extend({ ...filterShape, schoolId: z.string().trim().min(1).max(64).optional().meta({ description: "Filter satu sekolah." }) })
  .refine(rangeOk, RANGE_ERROR);

export const schoolAuditQuery = pageQuerySchema
  .extend({
    ...filterShape,
    schoolId: z.string().trim().min(1).max(64).optional().meta({ description: "Wajib untuk SUPER_ADMIN; admin sekolah memakai sekolahnya sendiri." }),
  })
  .refine(rangeOk, RANGE_ERROR);

export type AuditQuery = z.output<typeof platformAuditQuery>;

export const auditLogSchema = z
  .object({
    id: z.string(),
    createdAt: z.iso.datetime(),
    actor: z.object({ id: z.string(), name: z.string(), role: userRoleSchema }).nullable(),
    action: z.string(),
    entityType: z.string(),
    entityId: z.string(),
    before: z.unknown().meta({ description: "Snapshot sebelum (kunci rahasia sudah diredaksi)." }),
    after: z.unknown().meta({ description: "Snapshot sesudah (kunci rahasia sudah diredaksi)." }),
    ipAddress: z.string().nullable(),
  })
  .meta({ id: "AuditLogEntry" });

export type AuditLogDto = z.input<typeof auditLogSchema>;
