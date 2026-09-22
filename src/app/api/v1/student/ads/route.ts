import { serveAdsContract } from "@/lib/ads/contracts-student";
import { serveAds } from "@/lib/ads/serving-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(serveAdsContract, async (_input, ctx) => ({ data: await serveAds(ctx) }));
