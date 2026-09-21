import { recloseDayContract } from "@/lib/attendance/contracts-admin";
import { recloseSchoolDay } from "@/lib/attendance/reclose-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const POST = defineRoute(recloseDayContract, async ({ body }, ctx) => ({ data: await recloseSchoolDay(body, ctx) }));
