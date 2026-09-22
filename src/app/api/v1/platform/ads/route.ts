import { listPlatformAds } from "@/lib/ads/ad-queries";
import { listPlatformAdsContract } from "@/lib/ads/contracts-platform";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(listPlatformAdsContract, async ({ query }, ctx) => listPlatformAds(query, ctx.now));
