import { monthlyRecapContract } from "@/lib/attendance/contracts-monitor";
import { getMonthlyRecap } from "@/lib/attendance/monthly-recap-queries";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(monthlyRecapContract, async ({ query }, ctx) => ({ data: await getMonthlyRecap(ctx, query) }));
