import { requirePrincipal } from "@/lib/auth/principal";
import { defineRoute } from "@/lib/http/route";
import { getSchoolThemeContract, resetSchoolThemeContract, updateSchoolThemeContract } from "@/lib/schools/contracts";
import { getSchoolTheme, resetSchoolTheme, updateSchoolTheme } from "@/lib/schools/theme-service";
import { resolveSchoolScope } from "@/lib/tenant/scope";

export const runtime = "nodejs";

export const GET = defineRoute(getSchoolThemeContract, async ({ query }, ctx) => ({
  data: await getSchoolTheme(resolveSchoolScope(requirePrincipal(ctx), query.schoolId)),
}));

export const PUT = defineRoute(updateSchoolThemeContract, async ({ query, body }, ctx) => ({
  data: await updateSchoolTheme(resolveSchoolScope(requirePrincipal(ctx), query.schoolId), body, ctx),
}));

export const DELETE = defineRoute(resetSchoolThemeContract, async ({ query }, ctx) => ({
  data: await resetSchoolTheme(resolveSchoolScope(requirePrincipal(ctx), query.schoolId), ctx),
}));
