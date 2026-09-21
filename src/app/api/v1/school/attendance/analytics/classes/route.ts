import { getClassAnalytics } from "@/lib/attendance/analytics-queries";
import { classAnalyticsContract } from "@/lib/attendance/contracts-monitor";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(classAnalyticsContract, async ({ query }, ctx) => getClassAnalytics(ctx, query));
