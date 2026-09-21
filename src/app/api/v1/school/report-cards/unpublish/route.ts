import { defineRoute } from "@/lib/http/route";
import { unpublishContract } from "@/lib/report-cards/contracts";
import { unpublishReportCards } from "@/lib/report-cards/publish-service";

export const runtime = "nodejs";
export const POST = defineRoute(unpublishContract, async ({ query, body }, ctx) => ({ data: await unpublishReportCards(ctx, query.schoolId, body) }));
