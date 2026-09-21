import { deleteSubjectContract, updateSubjectContract } from "@/lib/academics/contracts-classes";
import { schoolScopeOf } from "@/lib/academics/guards";
import { deleteSubject, updateSubject } from "@/lib/academics/subjects-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const PATCH = defineRoute(updateSubjectContract, async ({ params, query, body }, ctx) => ({
  data: await updateSubject(schoolScopeOf(ctx, query.schoolId), params.id, body, ctx),
}));
export const DELETE = defineRoute(deleteSubjectContract, async ({ params, query }, ctx) => ({
  data: await deleteSubject(schoolScopeOf(ctx, query.schoolId), params.id, ctx),
}));
