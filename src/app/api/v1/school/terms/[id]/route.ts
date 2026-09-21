import { deleteTermContract, updateTermContract } from "@/lib/academics/contracts-years";
import { schoolScopeOf } from "@/lib/academics/guards";
import { deleteTerm, updateTerm } from "@/lib/academics/terms-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const PATCH = defineRoute(updateTermContract, async ({ params, query, body }, ctx) => ({
  data: await updateTerm(schoolScopeOf(ctx, query.schoolId), params.id, body, ctx),
}));
export const DELETE = defineRoute(deleteTermContract, async ({ params, query }, ctx) => ({
  data: await deleteTerm(schoolScopeOf(ctx, query.schoolId), params.id, ctx),
}));
