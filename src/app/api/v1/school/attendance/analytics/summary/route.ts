import { getSummaryAnalytics } from "@/lib/attendance/analytics-queries";
import { summaryAnalyticsContract } from "@/lib/attendance/contracts-monitor";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(summaryAnalyticsContract, async ({ query }, ctx) => ({ data: await getSummaryAnalytics(ctx, query) }));
