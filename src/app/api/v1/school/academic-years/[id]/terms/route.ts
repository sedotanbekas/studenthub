import { createTermContract } from "@/lib/academics/contracts-years";
import { schoolScopeOf } from "@/lib/academics/guards";
import { createTerm } from "@/lib/academics/terms-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const POST = defineRoute(createTermContract, async ({ params, query, body }, ctx) => ({
  data: await createTerm(schoolScopeOf(ctx, query.schoolId), params.id, body, ctx),
}));
