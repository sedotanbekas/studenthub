import { defineRoute } from "@/lib/http/route";
import { importStudentsContract } from "@/lib/students/contracts";
import { importStudents } from "@/lib/students/import/import-service";

export const runtime = "nodejs";
export const POST = defineRoute(importStudentsContract, async ({ query, body }, ctx) => ({ data: await importStudents(ctx, query.schoolId, body) }));
