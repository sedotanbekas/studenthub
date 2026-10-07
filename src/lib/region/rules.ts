import type { RegionScope } from "@/lib/auth/principal";

/**
 * Aturan murni wilayah Admin Pemda (REGION_ADMIN, 2026-10-07): admin provinsi melihat semua sekolah di provinsinya,
 * admin kota hanya sekolah di kota itu. Kode Kemendagri: provinsi "32", kota "32.76".
 */
export function regionSchoolWhere(region: RegionScope): { provinceCode: string; cityCode?: string } {
  return region.cityCode ? { provinceCode: region.provinceCode, cityCode: region.cityCode } : { provinceCode: region.provinceCode };
}

export function schoolInRegion(region: RegionScope, school: { provinceCode: string; cityCode: string }): boolean {
  return school.provinceCode === region.provinceCode && (region.cityCode === null || school.cityCode === region.cityCode);
}

export function cityInProvince(cityCode: string, provinceCode: string): boolean {
  return /^\d{2}\.\d{2}$/.test(cityCode) && cityCode.startsWith(`${provinceCode}.`);
}
