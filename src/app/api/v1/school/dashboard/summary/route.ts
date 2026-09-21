import { dashboardSummaryContract } from "@/lib/dashboard/contracts";
import { getDashboardSummary } from "@/lib/dashboard/queries";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(dashboardSummaryContract, async ({ query }, ctx) => ({ data: await getDashboardSummary(ctx, query) }));
