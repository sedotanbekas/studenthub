import { schoolScopeOf } from "@/lib/academics/guards";
import { defineRoute } from "@/lib/http/route";
import { assignSchoolAdminAccessRoleContract } from "@/lib/roles/contracts";
import { assignSchoolAdminAccessRole } from "@/lib/school-admins/service";

export const runtime = "nodejs";

export const PUT = defineRoute(assignSchoolAdminAccessRoleContract, async ({ params, query, body }, ctx) => ({
  data: await assignSchoolAdminAccessRole(schoolScopeOf(ctx, query.schoolId), params.id, body.accessRoleId, ctx),
}));
