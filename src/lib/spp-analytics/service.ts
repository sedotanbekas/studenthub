import { requirePrincipal, type ActionContext, type Principal } from "@/lib/auth/principal";
import { prisma } from "@/lib/db";
import { notFound } from "@/lib/http/errors";
import { schoolInRegion } from "@/lib/region/rules";
import { wibDate } from "@/lib/time/zone";
import { arrearsStudents, breakdownOf, totalsOf, trendOf } from "./queries";
import { childLevelOf, periodWindow, resolveAnalyticsScope, type ScopeFilter } from "./rules";
import type { SppAnalyticsDto, SppAnalyticsQuery } from "./schemas";

/**
 * GET /analytics/spp: lingkup diputuskan aturan murni (rules.ts), lalu wilayah/sekolahnya diverifikasi di sini
 * (ada; untuk Admin Pemda juga berada di wilayahnya) sebelum agregat dihitung. Tidak ada -> 404 (tanpa bocoran).
 */
const schoolNotFound = () => notFound("Sekolah tidak ditemukan.", "SCHOOL_NOT_FOUND");
const regionNotFound = () => notFound("Wilayah tidak ditemukan.", "REGION_NOT_FOUND");

async function schoolLabel(principal: Principal, schoolId: string): Promise<string> {
  const school = await prisma.school.findFirst({ where: { id: schoolId }, select: { name: true, provinceCode: true, cityCode: true } });
  if (!school) throw schoolNotFound();
  if (principal.role === "REGION_ADMIN" && (!principal.region || !schoolInRegion(principal.region, school))) throw schoolNotFound();
  return school.name;
}

async function scopeLabel(principal: Principal, scope: ScopeFilter): Promise<string> {
  if (scope.schoolId) return schoolLabel(principal, scope.schoolId);
  if (scope.cityCode) {
    const city = await prisma.city.findFirst({ where: { code: scope.cityCode, provinceCode: scope.provinceCode ?? undefined }, select: { name: true, province: { select: { name: true } } } });
    if (!city) throw regionNotFound();
    return `${city.name}, ${city.province.name}`;
  }
  if (scope.provinceCode) {
    const province = await prisma.province.findUnique({ where: { code: scope.provinceCode }, select: { name: true } });
    if (!province) throw regionNotFound();
    return province.name;
  }
  return "Seluruh Indonesia";
}

export async function getSppAnalytics(query: SppAnalyticsQuery, ctx: ActionContext): Promise<SppAnalyticsDto> {
  const principal = requirePrincipal(ctx);
  const scope = resolveAnalyticsScope({ role: principal.role, schoolId: principal.schoolId, region: principal.region ?? null }, query);
  const label = await scopeLabel(principal, scope);
  const window = periodWindow(ctx.now, query.months);
  const childLevel = childLevelOf(scope.level);
  const [totals, trend, breakdown, students] = await Promise.all([
    totalsOf(scope, window, ctx.now),
    trendOf(scope, window, ctx.now),
    breakdownOf(scope, childLevel, window, ctx.now),
    arrearsStudents(scope, window, ctx.now),
  ]);
  return {
    scope: { ...scope, label, childLevel },
    period: { from: window.periods[0] ?? "", to: window.periods.at(-1) ?? "", months: query.months },
    asOf: wibDate(ctx.now),
    totals, trend, breakdown, students,
  };
}
