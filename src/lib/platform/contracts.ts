import { z } from "zod";
import { defineContract } from "@/lib/http/contract";
import { citySchema, enumLabelsSchema, provinceCodeParams, provinceSchema } from "./schemas";

export const metaEnumsContract = defineContract({
  id: "getEnumLabels",
  method: "GET",
  path: "/api/v1/meta/enums",
  tag: "Meta",
  summary: "Label Bahasa Indonesia untuk semua kode enum",
  action: "public",
  response: enumLabelsSchema,
});

export const listProvincesContract = defineContract({
  id: "listProvinces",
  method: "GET",
  path: "/api/v1/regions/provinces",
  tag: "Wilayah",
  summary: "Daftar provinsi (kode Kemendagri)",
  action: "region.read",
  response: z.array(provinceSchema),
});

export const listCitiesContract = defineContract({
  id: "listCitiesOfProvince",
  method: "GET",
  path: "/api/v1/regions/provinces/{code}/cities",
  tag: "Wilayah",
  summary: "Daftar kabupaten/kota dalam satu provinsi",
  action: "region.read",
  params: provinceCodeParams,
  response: z.array(citySchema),
});

export const platformContracts = [metaEnumsContract, listProvincesContract, listCitiesContract] as const;
