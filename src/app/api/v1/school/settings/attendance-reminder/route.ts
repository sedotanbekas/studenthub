import { requirePrincipal } from "@/lib/auth/principal";
import { defineRoute } from "@/lib/http/route";
import { getAttendanceReminderSettingsContract, updateAttendanceReminderSettingsContract } from "@/lib/schools/contracts";
import { getAttendanceReminderSettings, updateAttendanceReminderSettings } from "@/lib/schools/reminder-service";
import { resolveSchoolScope } from "@/lib/tenant/scope";

export const runtime = "nodejs";

export const GET = defineRoute(getAttendanceReminderSettingsContract, async ({ query }, ctx) => ({
  data: await getAttendanceReminderSettings(resolveSchoolScope(requirePrincipal(ctx), query.schoolId), ctx),
}));

export const PUT = defineRoute(updateAttendanceReminderSettingsContract, async ({ query, body }, ctx) => ({
  data: await updateAttendanceReminderSettings(resolveSchoolScope(requirePrincipal(ctx), query.schoolId), body, ctx),
}));
