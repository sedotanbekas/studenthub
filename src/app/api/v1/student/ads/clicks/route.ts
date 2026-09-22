import { recordClickContract } from "@/lib/ads/contracts-student";
import { clickResponse } from "@/lib/ads/event-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const POST = defineRoute(recordClickContract, async ({ body }, ctx) => ({ data: await clickResponse(ctx, body) }));
