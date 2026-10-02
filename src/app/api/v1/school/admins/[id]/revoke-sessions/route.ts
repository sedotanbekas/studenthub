import { schoolScopeOf } from "@/lib/academics/guards";
import { defineRoute } from "@/lib/http/route";
import { revokeSchoolAdminSessionsContract } from "@/lib/school-admins/contracts";
import { revokeSchoolAdminSessions } from "@/lib/school-admins/service";

export const runtime = "nodejs";

export const POST = defineRoute(revokeSchoolAdminSessionsContract, async ({ params, query }, ctx) => ({
  data: await revokeSchoolAdminSessions(schoolScopeOf(ctx, query.schoolId), params.id, ctx),
}));
