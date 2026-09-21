import { checkInAttendanceContract } from "@/lib/attendance/contracts-student";
import { checkIn } from "@/lib/attendance/check-in-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const POST = defineRoute(checkInAttendanceContract, async ({ body }, ctx) => {
  const outcome = await checkIn(body, ctx);
  return { data: outcome.result, status: outcome.status };
});
