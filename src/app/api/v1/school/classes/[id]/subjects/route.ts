import { setClassSubjects } from "@/lib/academics/class-subjects-service";
import { getClassSubjectsContract, setClassSubjectsContract } from "@/lib/academics/contracts-classes";
import { schoolScopeOf } from "@/lib/academics/guards";
import { readClassSubjects } from "@/lib/academics/queries";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(getClassSubjectsContract, async ({ params, query }, ctx) => ({
  data: await readClassSubjects(schoolScopeOf(ctx, query.schoolId), params.id),
}));
export const PUT = defineRoute(setClassSubjectsContract, async ({ params, query, body }, ctx) => ({
  data: await setClassSubjects(schoolScopeOf(ctx, query.schoolId), params.id, body, ctx),
}));
