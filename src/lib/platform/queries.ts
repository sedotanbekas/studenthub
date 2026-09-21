import { prisma } from "@/lib/db";
import { notFound } from "@/lib/http/errors";

export async function listProvinces(): Promise<Array<{ code: string; name: string }>> {
  return prisma.province.findMany({ orderBy: { code: "asc" }, select: { code: true, name: true } });
}

export async function listCities(provinceCode: string): Promise<Array<{ code: string; provinceCode: string; name: string }>> {
  const province = await prisma.province.findUnique({ where: { code: provinceCode }, select: { code: true } });
  if (!province) throw notFound("Provinsi tidak ditemukan.");
  return prisma.city.findMany({
    where: { provinceCode },
    orderBy: { code: "asc" },
    select: { code: true, provinceCode: true, name: true },
  });
}
