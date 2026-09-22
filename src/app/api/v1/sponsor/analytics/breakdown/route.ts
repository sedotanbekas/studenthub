import { analyticsBreakdown } from "@/lib/ads/analytics-queries";
import { analyticsBreakdownContract } from "@/lib/ads/contracts-analytics";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(analyticsBreakdownContract, async ({ query }, ctx) => ({ data: await analyticsBreakdown(ctx, query) }));
