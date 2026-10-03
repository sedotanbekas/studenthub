import { schoolScopeOf } from "@/lib/academics/guards";
import { defineRoute } from "@/lib/http/route";
import { updateSchoolAdminNotificationPreferencesContract } from "@/lib/school-admins/contracts";
import { updateSchoolAdminNotificationPreferences } from "@/lib/school-admins/service";

export const runtime = "nodejs";

export const PUT = defineRoute(updateSchoolAdminNotificationPreferencesContract, async ({ params, query, body }, ctx) => ({
  data: await updateSchoolAdminNotificationPreferences(schoolScopeOf(ctx, query.schoolId), params.id, body, ctx),
}));
