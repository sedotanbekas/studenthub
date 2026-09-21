import { defineRoute } from "@/lib/http/route";
import { importTemplateContract } from "@/lib/students/contracts";
import { downloadImportTemplate } from "@/lib/students/import/template-service";

export const runtime = "nodejs";
export const GET = defineRoute(importTemplateContract, async ({ query }, ctx) => downloadImportTemplate(ctx, query.schoolId));
