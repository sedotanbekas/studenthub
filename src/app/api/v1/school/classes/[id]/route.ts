import { deleteClass, updateClass } from "@/lib/academics/classes-service";
import { deleteClassContract, updateClassContract } from "@/lib/academics/contracts-classes";
import { schoolScopeOf } from "@/lib/academics/guards";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const PATCH = defineRoute(updateClassContract, async ({ params, query, body }, ctx) => ({
  data: await updateClass(schoolScopeOf(ctx, query.schoolId), params.id, body, ctx),
}));
export const DELETE = defineRoute(deleteClassContract, async ({ params, query }, ctx) => ({
  data: await deleteClass(schoolScopeOf(ctx, query.schoolId), params.id, ctx),
}));
