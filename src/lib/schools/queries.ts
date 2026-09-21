import type { Prisma, StudentStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { notFound } from "@/lib/http/errors";
import { toSkipTake } from "@/lib/http/pagination";
import type { SchoolScope } from "@/lib/tenant/scope";
import { SCHOOL_INCLUDE, toActiveTermDto, toSchoolDto } from "./dto";
import type { ListSchoolsQuery, PlatformSchoolDetailDto, SchoolDto, SchoolListItemDto, SchoolProfileDto } from "./schemas";

export const SCHOOL_NOT_FOUND_MESSAGE = "Sekolah tidak ditemukan.";

const STUDENT_STATUSES: readonly StudentStatus[] = ["DRAFT", "ACTIVE", "INACTIVE", "GRADUATED", "MOVED"];

function listWhere(query: ListSchoolsQuery): Prisma.SchoolWhereInput {
  return {
    ...(query.q ? { OR: [{ name: { contains: query.q } }, { npsn: { startsWith: query.q } }] } : {}),
    ...(query.provinceCode ? { provinceCode: query.provinceCode } : {}),
    ...(query.cityCode ? { cityCode: query.cityCode } : {}),
    ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
  };
}

/** Daftar sekolah (SUPER_ADMIN) + jumlah siswa aktif per baris. */
export async function listSchools(query: ListSchoolsQuery): Promise<{ items: SchoolListItemDto[]; total: number }> {
  const where = listWhere(query);
  const [total, rows] = await Promise.all([
    prisma.school.count({ where }),
    prisma.school.findMany({
      where,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      ...toSkipTake(query),
      include: { ...SCHOOL_INCLUDE, _count: { select: { students: { where: { status: "ACTIVE" } } } } },
    }),
  ]);
  const items = rows.map((row) => ({
    id: row.id,
    npsn: row.npsn,
    name: row.name,
    province: row.province,
    city: row.city,
    timezone: row.timezone,
    isActive: row.isActive,
    activeStudentCount: row._count.students,
    createdAt: row.createdAt.toISOString(),
  }));
  return { items, total };
}

/** Detail sekolah apa pun (tanpa scope tenant: School adalah tenant itu sendiri). */
export async function getSchoolDto(schoolId: string): Promise<SchoolDto> {
  const row = await prisma.school.findUnique({ where: { id: schoolId }, include: SCHOOL_INCLUDE });
  if (!row) throw notFound(SCHOOL_NOT_FOUND_MESSAGE);
  return toSchoolDto(row);
}

async function studentsByStatus(schoolId: string): Promise<Record<StudentStatus, number>> {
  const groups = await prisma.student.groupBy({ by: ["status"], where: { schoolId }, _count: { _all: true } });
  const counts = new Map(groups.map((g) => [g.status, g._count._all]));
  return Object.fromEntries(STUDENT_STATUSES.map((status) => [status, counts.get(status) ?? 0])) as Record<StudentStatus, number>;
}

export async function getPlatformSchoolDetail(schoolId: string): Promise<PlatformSchoolDetailDto> {
  const school = await getSchoolDto(schoolId);
  const [byStatus, adminCount, activeAdminCount] = await Promise.all([
    studentsByStatus(schoolId),
    prisma.user.count({ where: { schoolId, role: "SCHOOL_ADMIN" } }),
    prisma.user.count({ where: { schoolId, role: "SCHOOL_ADMIN", isActive: true } }),
  ]);
  return { ...school, counts: { studentsByStatus: byStatus, adminCount, activeAdminCount } };
}

async function setupChecklist(schoolId: string, activeYearId: string | null): Promise<SchoolProfileDto["setupChecklist"]> {
  const [classCount, subjectCount, activeStudentCount, holidayCount] = await Promise.all([
    prisma.schoolClass.count({ where: { schoolId, isActive: true, ...(activeYearId ? { academicYearId: activeYearId } : {}) } }),
    prisma.subject.count({ where: { schoolId, isActive: true } }),
    prisma.student.count({ where: { schoolId, status: "ACTIVE" } }),
    prisma.holiday.count({ where: { schoolId } }),
  ]);
  return { hasActiveTerm: activeYearId !== null, classCount, subjectCount, activeStudentCount, holidayCount };
}

/** Profil sekolah untuk admin sekolah (atau SUPER_ADMIN dengan ?schoolId). */
export async function getSchoolProfile(scope: SchoolScope): Promise<SchoolProfileDto> {
  const row = await prisma.school.findUnique({
    where: { id: scope.schoolId },
    include: {
      ...SCHOOL_INCLUDE,
      activeTerm: {
        select: { id: true, semester: true, startDate: true, endDate: true, academicYearId: true, academicYear: { select: { name: true } } },
      },
    },
  });
  if (!row) throw notFound(SCHOOL_NOT_FOUND_MESSAGE);
  const activeTerm = toActiveTermDto(row.activeTerm);
  return {
    ...toSchoolDto(row),
    activeTerm,
    setupChecklist: await setupChecklist(row.id, row.activeTerm?.academicYearId ?? null),
  };
}
