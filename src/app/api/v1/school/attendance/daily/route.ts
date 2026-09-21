import { dailyContract } from "@/lib/attendance/contracts-monitor";
import { listDaily } from "@/lib/attendance/monitoring-queries";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(dailyContract, async ({ query }, ctx) => listDaily(ctx, query));
