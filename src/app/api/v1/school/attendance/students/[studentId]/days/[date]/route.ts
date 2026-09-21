import { correctAttendanceContract } from "@/lib/attendance/contracts-admin";
import { correctAttendance } from "@/lib/attendance/correction-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const PUT = defineRoute(correctAttendanceContract, async ({ params, query, body }, ctx) => ({
  data: await correctAttendance(ctx, query.schoolId, { studentId: params.studentId, date: params.date }, body),
}));
