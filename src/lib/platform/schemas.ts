import { z } from "zod";

export const provinceSchema = z.object({ code: z.string(), name: z.string() }).meta({ id: "Province" });
export const citySchema = z.object({ code: z.string(), provinceCode: z.string(), name: z.string() }).meta({ id: "City" });
export const provinceCodeParams = z.object({ code: z.string().regex(/^\d{2}$/, "Kode provinsi harus 2 digit.") });
export const enumLabelsSchema = z.record(z.string(), z.record(z.string(), z.string())).meta({ id: "EnumLabels" });
