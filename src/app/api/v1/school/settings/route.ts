import { requirePrincipal } from "@/lib/auth/principal";
import { defineRoute } from "@/lib/http/route";
import { updateSchoolSettingsContract } from "@/lib/schools/contracts";
import { updateSchoolSettings } from "@/lib/schools/service";
import { resolveSchoolScope } from "@/lib/tenant/scope";

export const runtime = "nodejs";

export const PATCH = defineRoute(updateSchoolSettingsContract, async ({ query, body }, ctx) => ({
  data: await updateSchoolSettings(resolveSchoolScope(requirePrincipal(ctx), query.schoolId), body, ctx),
}));
