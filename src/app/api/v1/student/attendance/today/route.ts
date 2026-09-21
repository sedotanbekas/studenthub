import { todayAttendanceContract } from "@/lib/attendance/contracts-student";
import { getTodayAttendance } from "@/lib/attendance/student-queries";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(todayAttendanceContract, async (_input, ctx) => ({ data: await getTodayAttendance(ctx) }));
