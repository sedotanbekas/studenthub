import { z } from "zod";
import { parseLocalDate } from "@/lib/time/zone";

/**
 * Potongan skema zod bersama domain akademik & kalender: tanggal lokal, id path, ?schoolId.
 */
export const localDateSchema = z
  .string()
  .refine((value) => parseLocalDate(value) !== null, "Tanggal harus berformat YYYY-MM-DD yang valid.")
  .meta({ format: "date", example: "2026-07-13" });

/** Tanggal lokal di respons ("YYYY-MM-DD"). */
export const dateOutSchema = z.string().meta({ format: "date", example: "2026-07-13" });

export const entityIdSchema = z.string().trim().min(1, "Id wajib diisi.").max(64, "Id terlalu panjang.");

export const idParams = z.object({ id: entityIdSchema });

/** Kosong diperlakukan sama dengan tidak diisi oleh resolveSchoolScope (SUPER_ADMIN -> 400 SCHOOL_ID_REQUIRED). */
export const schoolIdQuery = z.object({
  schoolId: z
    .string()
    .trim()
    .max(64, "schoolId terlalu panjang.")
    .optional()
    .meta({ description: "Wajib untuk SUPER_ADMIN; admin sekolah boleh mengosongkan." }),
});

/** Query boolean "true" | "false". */
export const queryBoolean = z.enum(["true", "false"]).transform((value) => value === "true");

export const deletedSchema = z.object({ id: z.string() });

/** Refinement PATCH: minimal satu field diisi. */
export const hasAnyField = (value: Record<string, unknown>): boolean => Object.values(value).some((v) => v !== undefined);
export const EMPTY_PATCH_MESSAGE = "Minimal satu field harus diubah.";
