import { recordImpressionsContract } from "@/lib/ads/contracts-student";
import { recordImpressions } from "@/lib/ads/event-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const POST = defineRoute(recordImpressionsContract, async ({ body }, ctx) => ({ data: await recordImpressions(ctx, body) }));
