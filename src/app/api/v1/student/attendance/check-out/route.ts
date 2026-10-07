import { checkOutAttendanceContract } from "@/lib/attendance/contracts-student";
import { checkOut } from "@/lib/attendance/check-out-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const POST = defineRoute(checkOutAttendanceContract, async ({ body }, ctx) => ({ data: await checkOut(body, ctx) }));
