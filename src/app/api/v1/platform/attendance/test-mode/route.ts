import { disableAttendanceTestModeContract, enableAttendanceTestModeContract, getAttendanceTestModeContract } from "@/lib/attendance/contracts-admin";
import { getAttendanceTestMode, setAttendanceTestMode } from "@/lib/attendance/test-mode";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(getAttendanceTestModeContract, async () => ({ data: await getAttendanceTestMode() }));
export const POST = defineRoute(enableAttendanceTestModeContract, async (_input, ctx) => ({ data: await setAttendanceTestMode(true, ctx) }));
export const DELETE = defineRoute(disableAttendanceTestModeContract, async (_input, ctx) => ({ data: await setAttendanceTestMode(false, ctx) }));
