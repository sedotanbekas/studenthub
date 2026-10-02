import { schoolScopeOf } from "@/lib/academics/guards";
import { defineRoute } from "@/lib/http/route";
import { activateSchoolAdminContract } from "@/lib/school-admins/contracts";
import { activateSchoolAdmin } from "@/lib/school-admins/service";

export const runtime = "nodejs";

export const POST = defineRoute(activateSchoolAdminContract, async ({ params, query }, ctx) => ({
  data: await activateSchoolAdmin(schoolScopeOf(ctx, query.schoolId), params.id, ctx),
}));
