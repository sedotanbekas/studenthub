import { mapContract } from "@/lib/attendance/contracts-monitor";
import { getMap } from "@/lib/attendance/monitoring-queries";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(mapContract, async ({ query }, ctx) => getMap(ctx, query));
