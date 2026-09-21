import { defineRoute } from "@/lib/http/route";
import { readinessContract } from "@/lib/report-cards/contracts";
import { getReadiness } from "@/lib/report-cards/queries";

export const runtime = "nodejs";
export const GET = defineRoute(readinessContract, async ({ query }, ctx) => ({ data: await getReadiness(ctx, query) }));
