import { recapContract } from "@/lib/attendance/contracts-monitor";
import { getRecap } from "@/lib/attendance/monitoring-queries";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(recapContract, async ({ query }, ctx) => ({ data: await getRecap(ctx, query) }));
