import { analyticsSummary } from "@/lib/ads/analytics-queries";
import { analyticsSummaryContract } from "@/lib/ads/contracts-analytics";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(analyticsSummaryContract, async ({ query }, ctx) => ({ data: await analyticsSummary(ctx, query) }));
