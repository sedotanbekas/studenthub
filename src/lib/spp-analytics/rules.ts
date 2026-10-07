import type { UserRole } from "@prisma/client";
import type { RegionScope } from "@/lib/auth/principal";
import { badRequest, forbidden, notFound } from "@/lib/http/errors";
import { cityInProvince } from "@/lib/region/rules";
import { localParts } from "@/lib/time/zone";

/**
 * Aturan murni Analitik SPP per lingkup (pemilik 2026-10-07): keseluruhan / provinsi / kabupaten-kota / sekolah.
 * Super admin: semua lingkup. Admin Pemda: hanya di dalam wilayahnya ("keseluruhan" = wilayahnya). Admin sekolah:
 * selalu sekolahnya sendiri. Sekolah pada lingkup "school" diverifikasi service (ada & di wilayah) -> 404.
 */
export const SCOPE_LEVELS = ["all", "province", "city", "school"] as const;
export type ScopeLevel = (typeof SCOPE_LEVELS)[number];
export type ChildLevel = "province" | "city" | "school" | "class";
export const PERIOD_MONTHS = [3, 6, 12] as const;

export interface Viewer {
  readonly role: UserRole;
  readonly schoolId: string | null;
  readonly region: RegionScope | null;
}

export interface ScopeRequest {
  readonly scope: ScopeLevel;
  readonly provinceCode?: string | undefined;
  readonly cityCode?: string | undefined;
  readonly schoolId?: string | undefined;
}

export interface ScopeFilter {
  readonly level: ScopeLevel;
  readonly provinceCode: string | null;
  readonly cityCode: string | null;
  readonly schoolId: string | null;
}

const filter = (level: ScopeLevel, provinceCode: string | null, cityCode: string | null, schoolId: string | null): ScopeFilter => ({ level, provinceCode, cityCode, schoolId });
const outOfRegion = () => notFound("Wilayah tidak ditemukan di cakupan akun Anda.", "REGION_NOT_FOUND");

function requested(q: ScopeRequest): ScopeFilter {
  if (q.scope === "province") {
    if (!q.provinceCode) throw badRequest("PROVINCE_REQUIRED", "Pilih provinsi terlebih dahulu.");
    return filter("province", q.provinceCode, null, null);
  }
  if (q.scope === "city") {
    if (!q.cityCode) throw badRequest("CITY_REQUIRED", "Pilih kabupaten/kota terlebih dahulu.");
    return filter("city", q.cityCode.slice(0, 2), q.cityCode, null);
  }
  if (q.scope === "school") {
    if (!q.schoolId) throw badRequest("SCHOOL_ID_REQUIRED", "Pilih sekolah terlebih dahulu.");
    return filter("school", null, null, q.schoolId);
  }
  return filter("all", null, null, null);
}

function forRegion(region: RegionScope, q: ScopeRequest): ScopeFilter {
  if (q.scope === "all") return filter(region.cityCode ? "city" : "province", region.provinceCode, region.cityCode, null);
  const wanted = requested(q);
  if (wanted.level === "school") return wanted;
  const inProvince = wanted.provinceCode === region.provinceCode;
  if (wanted.level === "province" && (!inProvince || region.cityCode)) throw outOfRegion();
  const cityOk = cityInProvince(wanted.cityCode ?? "", region.provinceCode) && (region.cityCode === null || wanted.cityCode === region.cityCode);
  if (wanted.level === "city" && (!inProvince || !cityOk)) throw outOfRegion();
  return wanted;
}

export function resolveAnalyticsScope(viewer: Viewer, q: ScopeRequest): ScopeFilter {
  if (viewer.role === "SCHOOL_ADMIN" && viewer.schoolId) {
    if (q.schoolId && q.schoolId !== viewer.schoolId) throw forbidden("SCOPE_MISMATCH", "Anda hanya dapat melihat sekolah Anda sendiri.");
    return filter("school", null, null, viewer.schoolId);
  }
  if (viewer.role === "SUPER_ADMIN") return requested(q);
  if (viewer.role === "REGION_ADMIN" && viewer.region) return forRegion(viewer.region, q);
  throw forbidden("FORBIDDEN", "Anda tidak memiliki akses ke analitik SPP.");
}

const CHILD: Readonly<Record<ScopeLevel, ChildLevel>> = { all: "province", province: "city", city: "school", school: "class" };
export const childLevelOf = (level: ScopeLevel): ChildLevel => CHILD[level];

export interface PeriodWindow {
  /** Kunci bulan = tahun × 12 + (bulan − 1), sama dengan billing/period-rules. */
  readonly fromKey: number;
  readonly toKey: number;
  /** "YYYY-MM" berurutan, bulan terakhir = bulan berjalan (WIB, zona pemilik platform). */
  readonly periods: readonly string[];
}

export const periodOfKey = (key: number): string => `${Math.floor(key / 12)}-${String((key % 12) + 1).padStart(2, "0")}`;

export function periodWindow(now: Date, months: number): PeriodWindow {
  const { year, month } = localParts(now, "WIB");
  const toKey = year * 12 + month - 1;
  const fromKey = toKey - (months - 1);
  return { fromKey, toKey, periods: Array.from({ length: months }, (_, i) => periodOfKey(fromKey + i)) };
}

/** Persen terbayar dari total tertagih (1 desimal); tanpa tagihan -> null. */
export function collectionRate(paid: number, billed: number): number | null {
  return billed > 0 ? Math.round((paid / billed) * 1000) / 10 : null;
}
