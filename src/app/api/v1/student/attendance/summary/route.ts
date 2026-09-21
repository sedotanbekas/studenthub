import { attendanceSummaryContract } from "@/lib/attendance/contracts-student";
import { getAttendanceSummary } from "@/lib/attendance/student-queries";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(attendanceSummaryContract, async ({ query }, ctx) => ({ data: await getAttendanceSummary(query, ctx) }));
