import { defineRoute } from "@/lib/http/route";
import { activateStudentContract } from "@/lib/students/contracts";
import { activateStudent } from "@/lib/students/lifecycle-service";

export const runtime = "nodejs";
export const POST = defineRoute(activateStudentContract, async ({ params, query }, ctx) => ({ data: await activateStudent(ctx, query.schoolId, params.id) }));
