import { schoolScopeOf } from "@/lib/academics/guards";
import { defineRoute } from "@/lib/http/route";
import { resetSchoolAdminPasswordContract } from "@/lib/school-admins/contracts";
import { resetSchoolAdminPassword } from "@/lib/school-admins/service";

export const runtime = "nodejs";

export const POST = defineRoute(resetSchoolAdminPasswordContract, async ({ params, query, body }, ctx) => ({
  data: await resetSchoolAdminPassword(schoolScopeOf(ctx, query.schoolId), params.id, body.newPassword, ctx),
}));
