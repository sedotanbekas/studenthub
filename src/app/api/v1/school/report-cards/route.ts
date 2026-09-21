import { defineRoute } from "@/lib/http/route";
import { createReportCardContract, listReportCardsContract } from "@/lib/report-cards/contracts";
import { createReportCard } from "@/lib/report-cards/card-service";
import { listReportCards } from "@/lib/report-cards/queries";

export const runtime = "nodejs";
export const GET = defineRoute(listReportCardsContract, async ({ query }, ctx) => listReportCards(ctx, query));
export const POST = defineRoute(createReportCardContract, async ({ query, body }, ctx) => ({
  data: await createReportCard(ctx, query.schoolId, body),
  status: 201,
}));
