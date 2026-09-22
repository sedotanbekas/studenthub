import { takedownAdContract } from "@/lib/ads/contracts-platform";
import { rejectAd } from "@/lib/ads/review-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const POST = defineRoute(takedownAdContract, async ({ params, body }, ctx) => ({ data: await rejectAd(params.id, { reason: body.reason }, ctx) }));
