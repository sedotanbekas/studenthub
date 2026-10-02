import { schoolScopeOf } from "@/lib/academics/guards";
import { defineRoute } from "@/lib/http/route";
import { deactivateSchoolAdminContract } from "@/lib/school-admins/contracts";
import { deactivateSchoolAdmin } from "@/lib/school-admins/service";

export const runtime = "nodejs";

export const POST = defineRoute(deactivateSchoolAdminContract, async ({ params, query, body }, ctx) => ({
  data: await deactivateSchoolAdmin(schoolScopeOf(ctx, query.schoolId), params.id, body.reason, ctx),
}));
