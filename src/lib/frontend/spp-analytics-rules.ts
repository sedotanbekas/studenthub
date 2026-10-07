import type { Role } from "./types";

/**
 * Aturan tampilan Analitik SPP (2026-10-07), tanpa DOM: pilihan lingkup per peran, query API, drill-down rincian,
 * serta seri grafik. Bentuk data = respons GET /analytics/spp (src/lib/spp-analytics/schemas.ts).
 */
export type ScopeLevel = "all" | "province" | "city" | "school";
export type ChildLevel = "province" | "city" | "school" | "class";
export interface Bucket { readonly count: number; readonly amount: number }
export interface Buckets {
  readonly onTime: Bucket; readonly late: Bucket; readonly overdue: Bucket; readonly notDue: Bucket;
  readonly billed: number; readonly paid: number; readonly outstanding: number; readonly collectionRate: number | null;
}
export interface SppAnalytics {
  readonly scope: { readonly level: ScopeLevel; readonly label: string; readonly childLevel: ChildLevel; readonly provinceCode: string | null; readonly cityCode: string | null; readonly schoolId: string | null };
  readonly period: { readonly from: string; readonly to: string; readonly months: number };
  readonly asOf: string;
  readonly totals: Buckets & { readonly invoices: number; readonly students: number; readonly overdueStudents: number; readonly lateStudents: number };
  readonly trend: readonly (Buckets & { readonly period: string })[];
  readonly breakdown: readonly (Buckets & { readonly key: string; readonly label: string; readonly students: number; readonly overdueStudents: number })[];
  readonly students: readonly { readonly studentId: string; readonly name: string; readonly nisn: string; readonly className: string | null; readonly schoolName: string; readonly overdueInvoices: number; readonly outstanding: number; readonly oldestDueDate: string | null; readonly lateInvoices: number }[];
}

export interface SppFilter {
  readonly scope: ScopeLevel;
  readonly provinceCode: string;
  readonly cityCode: string;
  readonly schoolId: string;
  readonly months: 3 | 6 | 12;
}
export const INITIAL_FILTER: SppFilter = { scope: "all", provinceCode: "", cityCode: "", schoolId: "", months: 6 };

export interface ViewerRegion { readonly provinceCode: string; readonly cityCode: string | null }

/** Lingkup yang bisa dipilih: super admin semua; Admin Pemda di dalam wilayahnya; admin sekolah tidak memilih. */
export function scopeOptions(role: Role, region: ViewerRegion | null | undefined): { value: ScopeLevel; label: string }[] {
  if (role === "SUPER_ADMIN") return [{ value: "all", label: "Keseluruhan" }, { value: "province", label: "Provinsi" }, { value: "city", label: "Kab/kota" }, { value: "school", label: "Sekolah" }];
  if (role === "REGION_ADMIN" && region) {
    return region.cityCode ? [{ value: "all", label: "Wilayah" }, { value: "school", label: "Sekolah" }] : [{ value: "all", label: "Wilayah" }, { value: "city", label: "Kab/kota" }, { value: "school", label: "Sekolah" }];
  }
  return [];
}

/** Pilihan yang belum lengkap (mis. lingkup provinsi tanpa provinsi) -> null: tampilkan ajakan memilih. */
export function sppQuery(f: SppFilter): string | null {
  const params = new URLSearchParams({ scope: f.scope, months: String(f.months) });
  if (f.scope === "province") { if (!f.provinceCode) return null; params.set("provinceCode", f.provinceCode); }
  if (f.scope === "city") { if (!f.cityCode) return null; params.set("cityCode", f.cityCode); }
  if (f.scope === "school") { if (!f.schoolId) return null; params.set("schoolId", f.schoolId); }
  return `/analytics/spp?${params.toString()}`;
}

/** Klik baris rincian = turun satu tingkat (kelas tidak bisa diturunkan). */
export function drillDown(f: SppFilter, child: ChildLevel, key: string): SppFilter | null {
  if (child === "province") return { ...f, scope: "province", provinceCode: key, cityCode: "", schoolId: "" };
  if (child === "city") return { ...f, scope: "city", provinceCode: key.slice(0, 2), cityCode: key, schoolId: "" };
  if (child === "school") return { ...f, scope: "school", schoolId: key };
  return null;
}

export const CHILD_TITLES: Readonly<Record<ChildLevel, string>> = { province: "Per provinsi", city: "Per kabupaten/kota", school: "Per sekolah", class: "Per kelas" };

export const SPP_CATEGORIES = [
  { key: "onTime", label: "Lunas tepat waktu", color: "var(--att-hadir)" },
  { key: "late", label: "Lunas telat", color: "var(--att-terlambat)" },
  { key: "overdue", label: "Menunggak", color: "var(--att-alpha)" },
  { key: "notDue", label: "Belum jatuh tempo", color: "var(--att-izin)" },
] as const;
export type SppCategory = (typeof SPP_CATEGORIES)[number]["key"];

/** Seri tren jumlah tagihan per kategori per bulan tagihan. */
export function trendSeries(trend: SppAnalytics["trend"]): { key: string; label: string; color: string; values: number[] }[] {
  return SPP_CATEGORIES.map(c => ({ key: c.key, label: c.label, color: c.color, values: trend.map(t => t[c.key].count) }));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
/** "2026-09" -> "Sep 2026". */
export function periodLabel(period: string): string {
  const [year, month] = period.split("-");
  return `${MONTHS[Number(month) - 1] ?? month} ${year}`;
}

/** Persen dengan koma desimal Indonesia; null -> "—". */
export const percentText = (value: number | null): string => (value === null ? "—" : `${value.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`);

/** Bagian tagihan menunggak dari semua tagihan (untuk kalimat ringkas). */
export function overdueShare(t: Buckets): number | null {
  const all = t.onTime.count + t.late.count + t.overdue.count + t.notDue.count;
  return all > 0 ? Math.round((t.overdue.count / all) * 1000) / 10 : null;
}
