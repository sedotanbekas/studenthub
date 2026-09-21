import { requirePrincipal } from "@/lib/auth/principal";
import { defineRoute } from "@/lib/http/route";
import { getSchoolProfileContract } from "@/lib/schools/contracts";
import { getSchoolProfile } from "@/lib/schools/queries";
import { resolveSchoolScope } from "@/lib/tenant/scope";

export const runtime = "nodejs";

export const GET = defineRoute(getSchoolProfileContract, async ({ query }, ctx) => ({
  data: await getSchoolProfile(resolveSchoolScope(requirePrincipal(ctx), query.schoolId)),
}));
