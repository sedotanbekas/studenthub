import { deleteAcademicYearContract, updateAcademicYearContract } from "@/lib/academics/contracts-years";
import { schoolScopeOf } from "@/lib/academics/guards";
import { deleteAcademicYear, updateAcademicYear } from "@/lib/academics/years-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const PATCH = defineRoute(updateAcademicYearContract, async ({ params, query, body }, ctx) => ({
  data: await updateAcademicYear(schoolScopeOf(ctx, query.schoolId), params.id, body, ctx),
}));
export const DELETE = defineRoute(deleteAcademicYearContract, async ({ params, query }, ctx) => ({
  data: await deleteAcademicYear(schoolScopeOf(ctx, query.schoolId), params.id, ctx),
}));
