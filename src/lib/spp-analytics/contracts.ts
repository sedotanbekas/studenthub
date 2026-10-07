import { defineContract, type AnyContract } from "@/lib/http/contract";
import { sppAnalyticsQuery, sppAnalyticsSchema } from "./schemas";

/** Kontrak Analitik SPP per lingkup (pemilik 2026-10-07). */
export const sppAnalyticsContract = defineContract({
  id: "getSppAnalytics",
  method: "GET",
  path: "/api/v1/analytics/spp",
  tag: "Analitik SPP",
  summary: "Analitik SPP: lunas tepat waktu, telat, menunggak per lingkup + daftar siswa",
  description:
    "Lingkup keseluruhan / provinsi / kabupaten-kota / sekolah. Super admin: semua; Admin Pemda: hanya wilayahnya (keseluruhan = wilayahnya); admin sekolah: sekolahnya sendiri. Berisi total, tren per bulan tagihan, rincian satu tingkat di bawah lingkup (provinsi -> kota -> sekolah -> kelas), dan paling banyak 50 siswa menunggak/telat. Di luar cakupan -> 404.",
  action: "billing.read",
  query: sppAnalyticsQuery,
  response: sppAnalyticsSchema,
  errors: ["PROVINCE_REQUIRED", "CITY_REQUIRED", "SCHOOL_ID_REQUIRED", "SCOPE_MISMATCH", "REGION_NOT_FOUND", "SCHOOL_NOT_FOUND"],
});

export const sppAnalyticsContracts: readonly AnyContract[] = [sppAnalyticsContract];
