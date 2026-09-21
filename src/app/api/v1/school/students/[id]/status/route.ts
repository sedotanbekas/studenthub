import { defineRoute } from "@/lib/http/route";
import { changeStudentStatusContract } from "@/lib/students/contracts";
import { changeStudentStatus } from "@/lib/students/lifecycle-service";

export const runtime = "nodejs";
export const POST = defineRoute(changeStudentStatusContract, async ({ params, query, body }, ctx) => ({
  data: await changeStudentStatus(ctx, query.schoolId, params.id, body),
}));
