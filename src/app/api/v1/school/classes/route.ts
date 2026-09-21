import { createClass } from "@/lib/academics/classes-service";
import { createClassContract, listClassesContract } from "@/lib/academics/contracts-classes";
import { schoolScopeOf } from "@/lib/academics/guards";
import { listClasses } from "@/lib/academics/queries";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(listClassesContract, async ({ query }, ctx) => ({
  data: await listClasses(schoolScopeOf(ctx, query.schoolId), query),
}));
export const POST = defineRoute(createClassContract, async ({ query, body }, ctx) => ({
  data: await createClass(schoolScopeOf(ctx, query.schoolId), body, ctx),
}));
