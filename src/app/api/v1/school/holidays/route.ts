import { schoolScopeOf } from "@/lib/academics/guards";
import { createSchoolHolidayContract, listSchoolHolidaysContract } from "@/lib/calendar/contracts";
import { createSchoolHoliday } from "@/lib/calendar/holiday-service";
import { listSchoolHolidays } from "@/lib/calendar/queries";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(listSchoolHolidaysContract, async ({ query }, ctx) => ({
  data: await listSchoolHolidays(schoolScopeOf(ctx, query.schoolId), query, ctx),
}));
export const POST = defineRoute(createSchoolHolidayContract, async ({ query, body }, ctx) => ({
  data: await createSchoolHoliday(schoolScopeOf(ctx, query.schoolId), body, ctx),
}));
