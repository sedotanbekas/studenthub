import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { pageMeta, type PageMeta } from "@/lib/http/envelope";
import { likeSearch } from "@/lib/http/like";
import { toSkipTake } from "@/lib/http/pagination";
import type { TargetingSchoolsQuery } from "./schemas";

/** Pemilih sekolah untuk target iklan: hanya sekolah aktif, tanpa data sensitif (nama & wilayah saja). */
export interface TargetSchoolDto {
  readonly id: string;
  readonly name: string;
  readonly provinceCode: string;
  readonly provinceName: string;
  readonly cityCode: string;
  readonly cityName: string;
}

export async function listTargetSchools(query: TargetingSchoolsQuery): Promise<{ data: TargetSchoolDto[]; meta: PageMeta }> {
  const q = likeSearch(query.q);
  const where: Prisma.SchoolWhereInput = {
    isActive: true,
    ...(q ? { name: { contains: q } } : {}),
    ...(query.provinceCode ? { provinceCode: query.provinceCode } : {}),
    ...(query.cityCode ? { cityCode: query.cityCode } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.school.count({ where }),
    prisma.school.findMany({
      where,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      ...toSkipTake(query),
      select: { id: true, name: true, provinceCode: true, cityCode: true, province: { select: { name: true } }, city: { select: { name: true } } },
    }),
  ]);
  const data = rows.map((r) => ({ id: r.id, name: r.name, provinceCode: r.provinceCode, provinceName: r.province.name, cityCode: r.cityCode, cityName: r.city.name }));
  return { data, meta: pageMeta(total, query.page, query.limit) };
}
