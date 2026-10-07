import { defineRoute } from "@/lib/http/route";
import { sppAnalyticsContract } from "@/lib/spp-analytics/contracts";
import { getSppAnalytics } from "@/lib/spp-analytics/service";

export const runtime = "nodejs";
export const GET = defineRoute(sppAnalyticsContract, async ({ query }, ctx) => ({ data: await getSppAnalytics(query, ctx) }));
