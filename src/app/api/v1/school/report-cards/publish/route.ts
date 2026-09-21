import { defineRoute } from "@/lib/http/route";
import { publishContract } from "@/lib/report-cards/contracts";
import { publishReportCards } from "@/lib/report-cards/publish-service";

export const runtime = "nodejs";
export const POST = defineRoute(publishContract, async ({ query, body }, ctx) => ({ data: await publishReportCards(ctx, query.schoolId, body) }));
