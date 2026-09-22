import { pauseAdContract } from "@/lib/ads/contracts-sponsor";
import { transitionOwnAd } from "@/lib/ads/lifecycle-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const POST = defineRoute(pauseAdContract, async ({ params }, ctx) => ({ data: await transitionOwnAd(ctx, params.id, "pause") }));
