import { getStudentMonth } from "@/lib/attendance/analytics-queries";
import { studentMonthContract } from "@/lib/attendance/contracts-monitor";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(studentMonthContract, async ({ params, query }, ctx) => getStudentMonth(ctx, params.studentId, query));
