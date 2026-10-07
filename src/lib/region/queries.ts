import type { Prisma } from "@prisma/client";
import type { RegionScope } from "@/lib/auth/principal";
import { prisma } from "@/lib/db";
import { likeSearch } from "@/lib/http/like";
import { toSkipTake } from "@/lib/http/pagination";
import { regionSchoolWhere } from "./rules";
import type { RegionSchoolDto, RegionSchoolsQuery } from "./schemas";

/** Sekolah di wilayah Admin Pemda (aktif & nonaktif) + jumlah siswa aktif. Saringan kota di luar wilayah = kosong. */
export async function listRegionSchools(region: RegionScope, query: RegionSchoolsQuery): Promise<{ items: RegionSchoolDto[]; total: number }> {
  const q = likeSearch(query.q);
  const where: Prisma.SchoolWhereInput = {
    AND: [
      regionSchoolWhere(region),
      ...(query.cityCode ? [{ cityCode: query.cityCode }] : []),
      ...(q ? [{ OR: [{ name: { contains: q } }, { npsn: { startsWith: q } }] }] : []),
    ],
  };
  const [total, rows] = await Promise.all([
    prisma.school.count({ where }),
    prisma.school.findMany({
      where,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      ...toSkipTake(query),
      select: {
        id: true, npsn: true, name: true, isActive: true, provinceCode: true, cityCode: true,
        province: { select: { name: true } }, city: { select: { name: true } },
        _count: { select: { students: { where: { status: "ACTIVE" } } } },
      },
    }),
  ]);
  const items = rows.map((row) => ({
    id: row.id, npsn: row.npsn, name: row.name, isActive: row.isActive,
    provinceCode: row.provinceCode, provinceName: row.province.name, cityCode: row.cityCode, cityName: row.city.name,
    activeStudentCount: row._count.students,
  }));
  return { items, total };
}
