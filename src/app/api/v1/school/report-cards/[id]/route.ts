import { defineRoute } from "@/lib/http/route";
import { deleteReportCardContract, getReportCardContract } from "@/lib/report-cards/contracts";
import { deleteReportCard } from "@/lib/report-cards/card-service";
import { getReportCard } from "@/lib/report-cards/queries";

export const runtime = "nodejs";
export const GET = defineRoute(getReportCardContract, async ({ params, query }, ctx) => ({ data: await getReportCard(ctx, query.schoolId, params.id) }));
export const DELETE = defineRoute(deleteReportCardContract, async ({ params, query }, ctx) => ({
  data: await deleteReportCard(ctx, query.schoolId, params.id),
}));
