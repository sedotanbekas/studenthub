import { schoolScopeOf } from "@/lib/academics/guards";
import { defineRoute } from "@/lib/http/route";
import { getSchoolAdminContract, updateSchoolAdminContract } from "@/lib/school-admins/contracts";
import { getSchoolAdmin } from "@/lib/school-admins/queries";
import { updateSchoolAdmin } from "@/lib/school-admins/service";

export const runtime = "nodejs";

export const GET = defineRoute(getSchoolAdminContract, async ({ params, query }, ctx) => ({
  data: await getSchoolAdmin(schoolScopeOf(ctx, query.schoolId), params.id),
}));

export const PATCH = defineRoute(updateSchoolAdminContract, async ({ params, query, body }, ctx) => ({
  data: await updateSchoolAdmin(schoolScopeOf(ctx, query.schoolId), params.id, body, ctx),
}));
