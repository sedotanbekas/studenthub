import { todayStatsContract } from "@/lib/attendance/contracts-monitor";
import { getTodayStats } from "@/lib/attendance/monitoring-queries";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(todayStatsContract, async ({ query }, ctx) => ({ data: await getTodayStats(ctx, query.schoolId) }));
