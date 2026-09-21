import { defineRoute } from "@/lib/http/route";
import { resetStudentPassword } from "@/lib/students/account-service";
import { resetStudentPasswordContract } from "@/lib/students/contracts";

export const runtime = "nodejs";
export const POST = defineRoute(resetStudentPasswordContract, async ({ params, query }, ctx) => ({
  data: await resetStudentPassword(ctx, query.schoolId, params.id),
}));
