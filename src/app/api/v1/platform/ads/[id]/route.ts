import { getPlatformAd } from "@/lib/ads/ad-queries";
import { getPlatformAdContract } from "@/lib/ads/contracts-platform";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(getPlatformAdContract, async ({ params }, ctx) => ({ data: await getPlatformAd(params.id, ctx.now) }));
