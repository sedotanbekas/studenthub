import { getClassTrend } from "@/lib/attendance/analytics-queries";
import { classTrendContract } from "@/lib/attendance/contracts-monitor";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(classTrendContract, async ({ params, query }, ctx) => ({ data: await getClassTrend(ctx, params.classId, query) }));
