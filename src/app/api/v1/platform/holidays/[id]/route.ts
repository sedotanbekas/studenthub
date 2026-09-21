import { deleteNationalHolidayContract, updateNationalHolidayContract } from "@/lib/calendar/contracts";
import { deleteNationalHoliday, updateNationalHoliday } from "@/lib/calendar/holiday-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const PATCH = defineRoute(updateNationalHolidayContract, async ({ params, body }, ctx) => ({
  data: await updateNationalHoliday(params.id, body, ctx),
}));
export const DELETE = defineRoute(deleteNationalHolidayContract, async ({ params }, ctx) => ({ data: await deleteNationalHoliday(params.id, ctx) }));
