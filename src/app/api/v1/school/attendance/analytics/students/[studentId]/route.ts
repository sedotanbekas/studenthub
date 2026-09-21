import { getStudentTrend } from "@/lib/attendance/analytics-queries";
import { studentTrendContract } from "@/lib/attendance/contracts-monitor";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(studentTrendContract, async ({ params, query }, ctx) => ({ data: await getStudentTrend(ctx, params.studentId, query) }));
