import { getStudentCalendarContract } from "@/lib/calendar/contracts";
import { getStudentCalendar } from "@/lib/calendar/queries";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(getStudentCalendarContract, async ({ query }, ctx) => ({ data: await getStudentCalendar(query, ctx) }));
