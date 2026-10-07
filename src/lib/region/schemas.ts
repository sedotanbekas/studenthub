import { z } from "zod";
import { pageQuerySchema } from "@/lib/http/pagination";

/** Skema domain wilayah Admin Pemda (2026-10-07). */
export const regionSchoolsQuery = pageQuerySchema.extend({
  q: z.string().trim().min(1).max(100).optional().meta({ description: "Cari nama sekolah atau awalan NPSN." }),
  cityCode: z.string().regex(/^\d{2}\.\d{2}$/, "Kode kabupaten/kota berformat 00.00.").optional().meta({ description: "Saring satu kabupaten/kota (admin provinsi)." }),
});
export type RegionSchoolsQuery = z.output<typeof regionSchoolsQuery>;

export const regionSchoolSchema = z
  .object({
    id: z.string(),
    npsn: z.string().nullable(),
    name: z.string(),
    isActive: z.boolean(),
    provinceCode: z.string(),
    provinceName: z.string(),
    cityCode: z.string(),
    cityName: z.string(),
    activeStudentCount: z.number().int(),
  })
  .meta({ id: "RegionSchool" });
export type RegionSchoolDto = z.input<typeof regionSchoolSchema>;
