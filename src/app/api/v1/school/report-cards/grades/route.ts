import { defineRoute } from "@/lib/http/route";
import { bulkGradesContract } from "@/lib/report-cards/contracts";
import { upsertClassGrades } from "@/lib/report-cards/grade-service";

export const runtime = "nodejs";
export const PUT = defineRoute(bulkGradesContract, async ({ query, body }, ctx) => ({ data: await upsertClassGrades(ctx, query.schoolId, body) }));
