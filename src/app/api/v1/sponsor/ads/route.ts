import { listOwnAdsFor } from "@/lib/ads/ad-queries";
import { createAd } from "@/lib/ads/ad-service";
import { createAdContract, listOwnAdsContract } from "@/lib/ads/contracts-sponsor";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(listOwnAdsContract, async ({ query }, ctx) => listOwnAdsFor(ctx, query));
export const POST = defineRoute(createAdContract, async ({ body }, ctx) => ({ data: await createAd(ctx, body), status: 201 }));
