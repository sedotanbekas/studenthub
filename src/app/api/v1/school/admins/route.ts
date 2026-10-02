import { schoolScopeOf } from "@/lib/academics/guards";
import { pageMeta } from "@/lib/http/envelope";
import { defineRoute } from "@/lib/http/route";
import { createSchoolAdminContract, listSchoolAdminsContract } from "@/lib/school-admins/contracts";
import { listSchoolAdmins } from "@/lib/school-admins/queries";
import { createSchoolAdmin } from "@/lib/school-admins/service";

export const runtime = "nodejs";

export const GET = defineRoute(listSchoolAdminsContract, async ({ query }, ctx) => {
  const { items, total } = await listSchoolAdmins(schoolScopeOf(ctx, query.schoolId), query);
  return { data: items, meta: pageMeta(total, query.page, query.limit) };
});

export const POST = defineRoute(createSchoolAdminContract, async ({ query, body }, ctx) => ({
  data: await createSchoolAdmin(schoolScopeOf(ctx, query.schoolId), body, ctx),
}));
