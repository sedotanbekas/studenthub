import { createNationalHolidayContract, listNationalHolidaysContract } from "@/lib/calendar/contracts";
import { createNationalHoliday } from "@/lib/calendar/holiday-service";
import { listNationalHolidays } from "@/lib/calendar/queries";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(listNationalHolidaysContract, async ({ query }, ctx) => ({ data: await listNationalHolidays(query, ctx) }));
export const POST = defineRoute(createNationalHolidayContract, async ({ body }, ctx) => ({ data: await createNationalHoliday(body, ctx) }));
