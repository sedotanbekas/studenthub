import { defineRoute } from "@/lib/http/route";
import { cardGradesContract } from "@/lib/report-cards/contracts";
import { upsertCardGrades } from "@/lib/report-cards/grade-service";

export const runtime = "nodejs";
export const PUT = defineRoute(cardGradesContract, async ({ params, query, body }, ctx) => ({
  data: await upsertCardGrades(ctx, query.schoolId, params.id, body),
}));
