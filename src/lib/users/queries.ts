import type { Prisma } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { notFound } from "@/lib/http/errors";
import { toSkipTake } from "@/lib/http/pagination";
import type { ListUsersQuery, PlatformUserDetailDto, PlatformUserDto } from "./schemas";

export const USER_NOT_FOUND_MESSAGE = "Pengguna tidak ditemukan.";

/** Kolom aman untuk DTO (tanpa passwordHash/TOTP; keduanya juga di-omit global). */
export const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  mustChangePassword: true,
  tempPasswordExpiresAt: true,
  lastLoginAt: true,
  passwordChangedAt: true,
  createdAt: true,
  updatedAt: true,
  school: { select: { id: true, name: true } },
  sponsor: { select: { id: true, companyName: true } },
} as const satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

const isoOrNull = (value: Date | null): string | null => (value ? value.toISOString() : null);

export function toUserDto(row: UserRow): PlatformUserDto {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    isActive: row.isActive,
    mustChangePassword: row.mustChangePassword,
    tempPasswordExpiresAt: isoOrNull(row.tempPasswordExpiresAt),
    school: row.school ? { id: row.school.id, name: row.school.name } : null,
    sponsor: row.sponsor ? { id: row.sponsor.id, companyName: row.sponsor.companyName } : null,
    lastLoginAt: isoOrNull(row.lastLoginAt),
    passwordChangedAt: isoOrNull(row.passwordChangedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function listWhere(query: ListUsersQuery): Prisma.UserWhereInput {
  return {
    ...(query.q ? { OR: [{ name: { contains: query.q } }, { email: { contains: query.q } }] } : {}),
    ...(query.role ? { role: query.role } : {}),
    ...(query.schoolId ? { schoolId: query.schoolId } : {}),
    ...(query.sponsorId ? { sponsorId: query.sponsorId } : {}),
    ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
  };
}

/** Pencarian semua akun (SUPER_ADMIN). */
export async function listUsers(query: ListUsersQuery): Promise<{ items: PlatformUserDto[]; total: number }> {
  const where = listWhere(query);
  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], ...toSkipTake(query), select: USER_SELECT }),
  ]);
  return { items: rows.map(toUserDto), total };
}

export async function getUserDto(userId: string, db: Tx = prisma): Promise<PlatformUserDto> {
  const row = await db.user.findUnique({ where: { id: userId }, select: USER_SELECT });
  if (!row) throw notFound(USER_NOT_FOUND_MESSAGE);
  return toUserDto(row);
}

export async function getUserDetail(userId: string, now: Date): Promise<PlatformUserDetailDto> {
  const user = await getUserDto(userId);
  const activeSessionCount = await prisma.authSession.count({ where: { userId, revokedAt: null, expiresAt: { gt: now } } });
  return { ...user, activeSessionCount };
}
