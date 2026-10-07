import { z } from "zod";
import { defineContract, type AnyContract } from "@/lib/http/contract";
import { regionSchoolSchema, regionSchoolsQuery } from "./schemas";

/** Kontrak Admin Pemda (REGION_ADMIN, 2026-10-07). Data sekolah dibaca lewat endpoint /school/* dengan ?schoolId=. */
const TAG = "Wilayah — Admin Pemda";

export const listRegionSchoolsContract = defineContract({
  id: "listRegionSchools",
  method: "GET",
  path: "/api/v1/region/schools",
  tag: TAG,
  summary: "Daftar sekolah di wilayah Admin Pemda",
  description: "Admin provinsi: semua sekolah di provinsinya (bisa disaring cityCode); admin kota: sekolah di kotanya. Data tiap sekolah dibuka lewat endpoint /school/* dengan ?schoolId= (baca saja); sekolah di luar wilayah -> 404.",
  action: "region.monitor",
  query: regionSchoolsQuery,
  response: z.array(regionSchoolSchema),
  pagination: "page",
});

export const regionContracts: readonly AnyContract[] = [listRegionSchoolsContract];
