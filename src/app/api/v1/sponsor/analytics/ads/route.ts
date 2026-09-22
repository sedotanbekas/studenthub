import { analyticsPerAd } from "@/lib/ads/analytics-queries";
import { analyticsAdsContract } from "@/lib/ads/contracts-analytics";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(analyticsAdsContract, async ({ query }, ctx) => analyticsPerAd(ctx, query));
