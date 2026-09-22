import { analyticsSeries } from "@/lib/ads/analytics-queries";
import { analyticsSeriesContract } from "@/lib/ads/contracts-analytics";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(analyticsSeriesContract, async ({ query }, ctx) => ({ data: await analyticsSeries(ctx, query) }));
