import { precheckAttendanceContract } from "@/lib/attendance/contracts-student";
import { precheckAttendance } from "@/lib/attendance/precheck-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const POST = defineRoute(precheckAttendanceContract, async ({ body }, ctx) => ({ data: await precheckAttendance(body, ctx) }));
