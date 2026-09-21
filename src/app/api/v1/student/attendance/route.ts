import { attendanceMonthContract } from "@/lib/attendance/contracts-student";
import { getAttendanceMonth } from "@/lib/attendance/student-queries";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(attendanceMonthContract, async ({ query }, ctx) => getAttendanceMonth(query, ctx));
