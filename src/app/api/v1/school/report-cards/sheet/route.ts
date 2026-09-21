import { defineRoute } from "@/lib/http/route";
import { gradeSheetContract } from "@/lib/report-cards/contracts";
import { getGradeSheet } from "@/lib/report-cards/queries";

export const runtime = "nodejs";
export const GET = defineRoute(gradeSheetContract, async ({ query }, ctx) => ({ data: await getGradeSheet(ctx, query) }));
