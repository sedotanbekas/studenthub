import { getSchoolTrend } from "@/lib/attendance/analytics-queries";
import { schoolTrendContract } from "@/lib/attendance/contracts-monitor";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(schoolTrendContract, async ({ query }, ctx) => ({ data: await getSchoolTrend(ctx, query) }));
