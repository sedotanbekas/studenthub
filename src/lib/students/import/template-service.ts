import type { ActionContext } from "@/lib/auth/principal";
import { prisma } from "@/lib/db";
import { loadSchoolContext, scopeFor } from "../records";
import { XLSX_MIME } from "./constants";
import { loadImportClasses } from "./lookups";
import { buildImportTemplate } from "./template";

/** GET /school/students/import/template -> unduhan XLSX (lampiran, no-store). */
export async function downloadImportTemplate(ctx: ActionContext, schoolId: string | undefined): Promise<Response> {
  const scope = scopeFor(ctx, schoolId);
  const school = await loadSchoolContext(prisma, scope);
  const classes = await loadImportClasses(prisma, scope, school);
  const bytes = await buildImportTemplate(classes.map((c) => c.name));
  return new Response(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: XLSX_MIME }), {
    status: 200,
    headers: {
      "Content-Type": XLSX_MIME,
      "Content-Disposition": 'attachment; filename="templat-impor-siswa.xlsx"',
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
