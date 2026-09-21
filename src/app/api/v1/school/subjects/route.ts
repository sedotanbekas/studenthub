import { createSubjectContract, listSubjectsContract } from "@/lib/academics/contracts-classes";
import { schoolScopeOf } from "@/lib/academics/guards";
import { listSubjects } from "@/lib/academics/queries";
import { createSubject } from "@/lib/academics/subjects-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(listSubjectsContract, async ({ query }, ctx) => ({
  data: await listSubjects(schoolScopeOf(ctx, query.schoolId), query),
}));
export const POST = defineRoute(createSubjectContract, async ({ query, body }, ctx) => ({
  data: await createSubject(schoolScopeOf(ctx, query.schoolId), body, ctx),
}));
