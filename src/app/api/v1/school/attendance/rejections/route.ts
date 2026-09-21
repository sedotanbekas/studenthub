import { rejectionsContract } from "@/lib/attendance/contracts-monitor";
import { listRejections } from "@/lib/attendance/monitoring-queries";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(rejectionsContract, async ({ query }, ctx) => listRejections(ctx, query));
