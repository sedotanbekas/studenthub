import { z } from "zod";

/** Komponen OpenAPI bersama: envelope sukses/gagal & meta paginasi. */
export const errorEnvelopeSchema = z
  .object({
    success: z.literal(false),
    data: z.null(),
    error: z.object({
      code: z.string().meta({ example: "VALIDATION_FAILED" }),
      message: z.string().meta({ example: "Data tidak valid." }),
      details: z.unknown().nullable(),
      requestId: z.string().nullable(),
    }),
    meta: z.null(),
  })
  .meta({ id: "ErrorEnvelope", description: "Bentuk respons gagal untuk semua endpoint." });

export const pageMetaSchema = z
  .object({ total: z.int(), page: z.int(), limit: z.int(), totalPages: z.int() })
  .meta({ id: "PageMeta" });

export const cursorMetaSchema = z
  .object({ limit: z.int(), nextCursor: z.string().nullable(), hasMore: z.boolean() })
  .meta({ id: "CursorMeta" });

export function envelopeOf(data: z.ZodType, pagination?: "page" | "cursor"): z.ZodType {
  const meta = pagination === "page" ? pageMetaSchema : pagination === "cursor" ? cursorMetaSchema : z.null();
  return z.object({ success: z.literal(true), data, error: z.null(), meta });
}
