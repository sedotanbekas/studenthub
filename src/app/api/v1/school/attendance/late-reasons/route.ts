import { lateReasonsContract } from "@/lib/attendance/contracts-monitor";
import { getLateReasonCounts } from "@/lib/attendance/late-reason-queries";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(lateReasonsContract, async ({ query }, ctx) => ({ data: await getLateReasonCounts(ctx, query) }));
