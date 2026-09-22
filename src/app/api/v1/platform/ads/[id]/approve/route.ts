import { approveAdContract } from "@/lib/ads/contracts-platform";
import { approveAd } from "@/lib/ads/review-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const POST = defineRoute(approveAdContract, async ({ params, body }, ctx) => ({ data: await approveAd(params.id, body.submittedAt, ctx) }));
