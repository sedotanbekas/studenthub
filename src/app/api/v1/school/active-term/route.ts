import { getActiveTermContract, setActiveTermContract } from "@/lib/academics/contracts-years";
import { schoolScopeOf } from "@/lib/academics/guards";
import { getActiveTerm } from "@/lib/academics/queries";
import { setActiveTerm } from "@/lib/academics/terms-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(getActiveTermContract, async ({ query }, ctx) => ({
  data: await getActiveTerm(schoolScopeOf(ctx, query.schoolId)),
}));
export const PUT = defineRoute(setActiveTermContract, async ({ query, body }, ctx) => ({
  data: await setActiveTerm(schoolScopeOf(ctx, query.schoolId), body, ctx),
}));
