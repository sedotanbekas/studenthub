import type { Prisma, UserRole } from "@prisma/client";
import type { Principal } from "@/lib/auth/principal";
import { POLICY } from "@/lib/auth/policy";
import { prisma, type Tx } from "@/lib/db";
import { notFound } from "@/lib/http/errors";
import { PERMISSION_CATALOG, PERMISSION_GROUPS } from "./catalog";
import { actionsForBase, lockedActions, resolveGrants } from "./rules";
import type { AccessRoleDetailDto, AccessRoleDto, ListAccessRolesQuery, PermissionCatalogDto } from "./schemas";

/** Baca peran akses RBAC. Admin sekolah hanya melihat peran berbasis SCHOOL_ADMIN (untuk dipasang ke guru). */
export const ROLE_NOT_FOUND = "Peran akses tidak ditemukan.";

const ROLE_SELECT = {
  id: true,
  key: true,
  name: true,
  description: true,
  baseRole: true,
  isSystem: true,
  permissions: true,
  knownActions: true,
  updatedAt: true,
} satisfies Prisma.AccessRoleSelect;
type RoleRow = Prisma.AccessRoleGetPayload<{ select: typeof ROLE_SELECT }>;

/**
 * Akun pemakai peran. Peran sistem juga mencakup akun tanpa peran (accessRoleId NULL) berjenis akun sama.
 * schoolId terisi (admin sekolah) = hanya akun sekolahnya (tanpa bocor jumlah lintas sekolah).
 */
function memberWhere(row: Pick<RoleRow, "id" | "isSystem" | "baseRole">, schoolId: string | null): Prisma.UserWhereInput {
  const base: Prisma.UserWhereInput = row.isSystem ? { role: row.baseRole, OR: [{ accessRoleId: row.id }, { accessRoleId: null }] } : { accessRoleId: row.id };
  return schoolId ? { AND: [base, { schoolId }] } : base;
}

const scopeSchool = (principal: Principal): string | null => (principal.role === "SCHOOL_ADMIN" ? principal.schoolId : null);

async function toDto(db: Tx, row: RoleRow, schoolId: string | null): Promise<AccessRoleDto> {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    baseRole: row.baseRole,
    isSystem: row.isSystem,
    permissions: [...resolveGrants(row, row.baseRole)],
    lockedPermissions: lockedActions(row.baseRole, row.isSystem),
    availablePermissions: actionsForBase(row.baseRole),
    userCount: await db.user.count({ where: memberWhere(row, schoolId) }),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Admin sekolah: paksa ke peran berbasis SCHOOL_ADMIN. */
export function visibleBase(principal: Principal, requested: UserRole | undefined): UserRole | undefined {
  return principal.role === "SCHOOL_ADMIN" ? "SCHOOL_ADMIN" : requested;
}

export async function listAccessRoles(principal: Principal, query: ListAccessRolesQuery): Promise<AccessRoleDto[]> {
  const base = visibleBase(principal, query.baseRole);
  const rows = await prisma.accessRole.findMany({
    where: base ? { baseRole: base } : {},
    select: ROLE_SELECT,
    orderBy: [{ isSystem: "desc" }, { baseRole: "asc" }, { name: "asc" }],
  });
  return Promise.all(rows.map((row) => toDto(prisma, row, scopeSchool(principal))));
}

export async function loadRole(db: Tx, id: string): Promise<RoleRow> {
  const row = await db.accessRole.findUnique({ where: { id }, select: ROLE_SELECT });
  if (!row) throw notFound(ROLE_NOT_FOUND);
  return row;
}

export async function getAccessRole(principal: Principal, id: string, db: Tx = prisma): Promise<AccessRoleDetailDto> {
  const row = await loadRole(db, id);
  const base = visibleBase(principal, row.baseRole);
  if (base !== row.baseRole) throw notFound(ROLE_NOT_FOUND);
  const members = await db.user.findMany({
    where: memberWhere(row, scopeSchool(principal)),
    select: { id: true, name: true, email: true, isActive: true, school: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return {
    ...(await toDto(db, row, scopeSchool(principal))),
    members: members.map((m) => ({ id: m.id, name: m.name, email: m.email, isActive: m.isActive, schoolName: m.school?.name ?? null })),
  };
}

/** Katalog hak akses per kelompok, terurut seperti POLICY di dalam kelompok. */
export function permissionCatalog(): PermissionCatalogDto {
  const entries = Object.entries(PERMISSION_CATALOG) as [keyof typeof PERMISSION_CATALOG, (typeof PERMISSION_CATALOG)[keyof typeof PERMISSION_CATALOG]][];
  return PERMISSION_GROUPS.map((group) => ({
    group,
    items: entries
      .filter(([, info]) => info.group === group)
      .map(([action, info]) => ({ action, label: info.label, hint: info.hint, baseRoles: [...POLICY[action].roles] })),
  })).filter((g) => g.items.length > 0);
}
