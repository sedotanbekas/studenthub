import { createAcademicYearContract, listAcademicYearsContract } from "@/lib/academics/contracts-years";
import { schoolScopeOf } from "@/lib/academics/guards";
import { listAcademicYears } from "@/lib/academics/queries";
import { createAcademicYear } from "@/lib/academics/years-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(listAcademicYearsContract, async ({ query }, ctx) => ({
  data: await listAcademicYears(schoolScopeOf(ctx, query.schoolId)),
}));
export const POST = defineRoute(createAcademicYearContract, async ({ query, body }, ctx) => ({
  data: await createAcademicYear(schoolScopeOf(ctx, query.schoolId), body, ctx),
}));
