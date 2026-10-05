import type { Prisma } from "@prisma/client";
import { verifyPassword } from "@/lib/auth/password";
import { prisma, type Tx } from "@/lib/db";
import { notFound } from "@/lib/http/errors";
import { likeSearch } from "@/lib/http/like";
import { toSkipTake } from "@/lib/http/pagination";
import { DEFAULT_STUDENT_PASSWORD } from "@/lib/students/constants";
import { loginIdentifiers, needsDefaultCheck, passwordState } from "./credential-rules";
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
  primarySchoolId: true,
  createdAt: true,
  updatedAt: true,
  school: { select: { id: true, name: true, npsn: true } },
  sponsor: { select: { id: true, companyName: true } },
  student: { select: { id: true, nisn: true, nis: true, activeNisn: true, status: true, currentClass: { select: { name: true } } } },
} as const satisfies Prisma.UserSelect;

/** Hash hanya dibaca untuk mengenali kata sandi bawaan siswa; tidak pernah masuk DTO. */
const HASHED_SELECT = { ...USER_SELECT, passwordHash: true } as const satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;
type HashedUserRow = Prisma.UserGetPayload<{ select: typeof HASHED_SELECT }>;

const isoOrNull = (value: Date | null): string | null => (value ? value.toISOString() : null);

function studentOf(row: UserRow): PlatformUserDto["student"] {
  const s = row.student;
  return s ? { id: s.id, nisn: s.nisn, nis: s.nis, status: s.status, className: s.currentClass?.name ?? null } : null;
}

function credentialOf(row: UserRow, matchesDefault: boolean, now: Date): Pick<PlatformUserDto, "logins" | "password" | "adminKind"> {
  const primaryNpsn = row.primarySchoolId !== null ? (row.school?.npsn ?? null) : null;
  return {
    logins: loginIdentifiers({ role: row.role, email: row.email, primaryNpsn, activeNisn: row.student?.activeNisn ?? null }),
    password: passwordState({ ...row, matchesDefault }, now),
    adminKind: row.role === "SCHOOL_ADMIN" ? (row.primarySchoolId !== null ? "PRIMARY" : "ADDITIONAL") : null,
  };
}

export function toUserDto(row: UserRow, matchesDefault: boolean, now: Date): PlatformUserDto {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    loginNpsn: row.primarySchoolId !== null ? (row.school?.npsn ?? null) : null,
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
    ...credentialOf(row, matchesDefault, now),
    student: studentOf(row),
  };
}

async function matchesDefaultPassword(row: HashedUserRow): Promise<boolean> {
  return needsDefaultCheck(row.role, row.mustChangePassword) && verifyPassword(DEFAULT_STUDENT_PASSWORD, row.passwordHash);
}

/**
 * bcrypt cost 8 ~10–15 ms per baris dan memakai threadpool yang sama dengan login: dicocokkan bertahap per BCRYPT_BATCH
 * agar satu halaman daftar tidak menahan login lain. Hanya siswa yang masih wajib ganti kata sandi yang dicocokkan.
 */
const BCRYPT_BATCH = 4;

async function defaultMatches(rows: readonly HashedUserRow[]): Promise<boolean[]> {
  const matches: boolean[] = [];
  for (let start = 0; start < rows.length; start += BCRYPT_BATCH) {
    matches.push(...(await Promise.all(rows.slice(start, start + BCRYPT_BATCH).map(matchesDefaultPassword))));
  }
  return matches;
}

async function toUserDtos(rows: readonly HashedUserRow[], now: Date): Promise<PlatformUserDto[]> {
  const defaults = await defaultMatches(rows);
  return rows.map((row, index) => toUserDto(row, defaults[index] ?? false, now));
}

/** `q` dicari harfiah: wildcard LIKE (`%`, `_`, `\`) diloloskan (lihat src/lib/http/like.ts). */
function listWhere(query: ListUsersQuery): Prisma.UserWhereInput {
  const q = likeSearch(query.q);
  return {
    ...(q ? { OR: [{ name: { contains: q } }, { email: { contains: q } }, { student: { nisn: { startsWith: q } } }] } : {}),
    ...(query.role ? { role: query.role } : {}),
    ...(query.schoolId ? { schoolId: query.schoolId } : {}),
    ...(query.sponsorId ? { sponsorId: query.sponsorId } : {}),
    ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
  };
}

/** Pencarian semua akun (SUPER_ADMIN). */
export async function listUsers(query: ListUsersQuery, now: Date): Promise<{ items: PlatformUserDto[]; total: number }> {
  const where = listWhere(query);
  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], ...toSkipTake(query), select: HASHED_SELECT }),
  ]);
  return { items: await toUserDtos(rows, now), total };
}

export async function getUserDto(userId: string, now: Date, db: Tx = prisma): Promise<PlatformUserDto> {
  const row = await db.user.findUnique({ where: { id: userId }, select: HASHED_SELECT });
  if (!row) throw notFound(USER_NOT_FOUND_MESSAGE);
  const [dto] = await toUserDtos([row], now);
  return dto as PlatformUserDto;
}

export async function getUserDetail(userId: string, now: Date): Promise<PlatformUserDetailDto> {
  const user = await getUserDto(userId, now);
  const activeSessionCount = await prisma.authSession.count({ where: { userId, revokedAt: null, expiresAt: { gt: now }, impersonatorId: null } });
  return { ...user, activeSessionCount };
}
