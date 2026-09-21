import { schoolScopeOf } from "@/lib/academics/guards";
import { deleteSchoolHolidayContract, updateSchoolHolidayContract } from "@/lib/calendar/contracts";
import { deleteSchoolHoliday, updateSchoolHoliday } from "@/lib/calendar/holiday-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const PATCH = defineRoute(updateSchoolHolidayContract, async ({ params, query, body }, ctx) => ({
  data: await updateSchoolHoliday(schoolScopeOf(ctx, query.schoolId), params.id, body, ctx),
}));
export const DELETE = defineRoute(deleteSchoolHolidayContract, async ({ params, query }, ctx) => ({
  data: await deleteSchoolHoliday(schoolScopeOf(ctx, query.schoolId), params.id, ctx),
}));
