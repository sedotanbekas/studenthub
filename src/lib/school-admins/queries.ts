import type { Prisma } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { notFound } from "@/lib/http/errors";
import { likeSearch } from "@/lib/http/like";
import { toSkipTake } from "@/lib/http/pagination";
import type { SchoolScope } from "@/lib/tenant/scope";
import type { ListSchoolAdminsQuery, SchoolAdminDto } from "./schemas";

export const SCHOOL_ADMIN_NOT_FOUND = "Akun admin tidak ditemukan.";

const ADMIN_SELECT = {
  id: true,
  name: true,
  email: true,
  primarySchoolId: true,
  isActive: true,
  mustChangePassword: true,
  tempPasswordExpiresAt: true,
  lastLoginAt: true,
  createdAt: true,
  school: { select: { npsn: true } },
} as const satisfies Prisma.UserSelect;

type AdminRow = Prisma.UserGetPayload<{ select: typeof ADMIN_SELECT }>;

function toSchoolAdminDto(row: AdminRow): SchoolAdminDto {
  const isPrimary = row.primarySchoolId !== null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    loginNpsn: isPrimary ? (row.school?.npsn ?? null) : null,
    isPrimary,
    isActive: row.isActive,
    mustChangePassword: row.mustChangePassword,
    tempPasswordExpiresAt: row.tempPasswordExpiresAt?.toISOString() ?? null,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Admin sekolah dalam cakupan; id sekolah lain / siswa / sponsor -> 404 (tenant). */
export async function getSchoolAdmin(scope: SchoolScope, id: string, db: Tx = prisma): Promise<SchoolAdminDto> {
  const row = await db.user.findFirst({ where: { id, schoolId: scope.schoolId, role: "SCHOOL_ADMIN" }, select: ADMIN_SELECT });
  if (!row) throw notFound(SCHOOL_ADMIN_NOT_FOUND);
  return toSchoolAdminDto(row);
}

/** Admin utama dulu, lalu nama; `q` dicari harfiah (wildcard LIKE diloloskan). */
export async function listSchoolAdmins(scope: SchoolScope, query: ListSchoolAdminsQuery): Promise<{ items: SchoolAdminDto[]; total: number }> {
  const q = likeSearch(query.q);
  const where: Prisma.UserWhereInput = {
    schoolId: scope.schoolId,
    role: "SCHOOL_ADMIN",
    ...(q ? { OR: [{ name: { contains: q } }, { email: { contains: q } }] } : {}),
    ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({ where, orderBy: [{ primarySchoolId: { sort: "desc", nulls: "last" } }, { name: "asc" }, { id: "asc" }], ...toSkipTake(query), select: ADMIN_SELECT }),
  ]);
  return { items: rows.map(toSchoolAdminDto), total };
}

export async function hasPrimaryAdmin(scope: SchoolScope): Promise<boolean> {
  return (await prisma.user.count({ where: { primarySchoolId: scope.schoolId } })) > 0;
}

export async function countSchoolAdmins(scope: SchoolScope): Promise<number> {
  return prisma.user.count({ where: { schoolId: scope.schoolId, role: "SCHOOL_ADMIN" } });
}
