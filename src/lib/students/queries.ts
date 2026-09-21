import type { Prisma } from "@prisma/client";
import type { ActionContext } from "@/lib/auth/principal";
import { requirePrincipal } from "@/lib/auth/principal";
import { prisma } from "@/lib/db";
import { pageMeta, type PageMeta } from "@/lib/http/envelope";
import { notFound } from "@/lib/http/errors";
import { toSkipTake } from "@/lib/http/pagination";
import { studentSelf, type SchoolScope } from "@/lib/tenant/scope";
import { fromDbDate } from "@/lib/time/zone";
import { getActivationGaps } from "./activation-rules";
import { activationInputOf, toStudentDetail } from "./dto";
import { findStudentRow, loadSchoolContext, scopeFor } from "./records";
import type { ListStudentsQuery, StudentDetail, StudentProfile } from "./schemas";
import { parseStudentSearch } from "./search-rules";

/** Query baca domain siswa (selalu ber-take / ber-scope). */
export interface StudentListRow {
  id: string;
  name: string;
  nisn: string;
  nis: string;
  gender: "MALE" | "FEMALE";
  status: "DRAFT" | "ACTIVE" | "INACTIVE" | "GRADUATED" | "MOVED";
  class: { id: string; name: string } | null;
  sppAmount: number | null;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
}

function listWhere(scope: SchoolScope, query: ListStudentsQuery): Prisma.StudentWhereInput {
  const search = parseStudentSearch(query.q);
  const or: Prisma.StudentWhereInput[] = search
    ? [
        { user: { name: { contains: search.nameContains } } },
        { nis: { startsWith: search.nisPrefix } },
        ...(search.nisnPrefix ? [{ nisn: { startsWith: search.nisnPrefix } }] : []),
      ]
    : [];
  return {
    schoolId: scope.schoolId,
    status: { in: query.status },
    ...(query.classId ? { currentClassId: query.classId } : {}),
    ...(query.gender ? { gender: query.gender } : {}),
    ...(or.length > 0 ? { OR: or } : {}),
  };
}

function listOrder(query: ListStudentsQuery): Prisma.StudentOrderByWithRelationInput[] {
  const primary: Prisma.StudentOrderByWithRelationInput =
    query.sort === "name" ? { user: { name: query.order } } : query.sort === "nis" ? { nis: query.order } : { createdAt: query.order };
  return [primary, { id: "asc" }];
}

export async function listStudents(ctx: ActionContext, query: ListStudentsQuery): Promise<{ data: StudentListRow[]; meta: PageMeta }> {
  const scope = scopeFor(ctx, query.schoolId);
  await loadSchoolContext(prisma, scope);
  const where = listWhere(scope, query);
  const [total, rows] = await Promise.all([
    prisma.student.count({ where }),
    prisma.student.findMany({
      where,
      orderBy: listOrder(query),
      ...toSkipTake(query),
      select: {
        id: true, nisn: true, nis: true, gender: true, status: true, sppAmount: true,
        user: { select: { name: true, mustChangePassword: true, lastLoginAt: true } },
        currentClass: { select: { id: true, name: true } },
      },
    }),
  ]);
  const data = rows.map((row) => ({
    id: row.id,
    name: row.user.name,
    nisn: row.nisn,
    nis: row.nis,
    gender: row.gender,
    status: row.status,
    class: row.currentClass,
    sppAmount: row.sppAmount,
    mustChangePassword: row.user.mustChangePassword,
    lastLoginAt: row.user.lastLoginAt?.toISOString() ?? null,
  }));
  return { data, meta: pageMeta(total, query.page, query.limit) };
}

/** Detail + kekurangan aktivasi terkini. */
export async function loadStudentDetail(scope: SchoolScope, id: string, now: Date): Promise<StudentDetail> {
  const [school, row] = await Promise.all([loadSchoolContext(prisma, scope), findStudentRow(prisma, scope, id)]);
  return toStudentDetail(row, getActivationGaps(activationInputOf(row, school), now));
}

export async function getStudentDetail(ctx: ActionContext, schoolId: string | undefined, id: string): Promise<StudentDetail> {
  return loadStudentDetail(scopeFor(ctx, schoolId), id, ctx.now);
}

/** Biodata milik siswa sendiri (baca-saja; id tidak pernah dari request). */
export async function getOwnProfile(ctx: ActionContext): Promise<StudentProfile> {
  const self = studentSelf(requirePrincipal(ctx));
  const row = await prisma.student.findFirst({
    where: { id: self.studentId, schoolId: self.schoolId },
    select: {
      nisn: true, nis: true, gender: true, birthPlace: true, birthDate: true, status: true,
      user: { select: { name: true } },
      currentClass: { select: { name: true } },
      school: { select: { name: true } },
    },
  });
  if (!row) throw notFound("Data siswa tidak ditemukan.");
  return {
    name: row.user.name,
    nisn: row.nisn,
    nis: row.nis,
    gender: row.gender,
    birthPlace: row.birthPlace,
    birthDate: row.birthDate === null ? null : fromDbDate(row.birthDate),
    className: row.currentClass?.name ?? null,
    school: { name: row.school.name },
    status: row.status,
  };
}
