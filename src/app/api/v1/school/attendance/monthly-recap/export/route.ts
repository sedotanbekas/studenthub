import { monthlyRecapExportContract } from "@/lib/attendance/contracts-monitor";
import { exportMonthlyRecap } from "@/lib/attendance/monthly-recap-export";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(monthlyRecapExportContract, async ({ query }, ctx) => exportMonthlyRecap(ctx, query));
