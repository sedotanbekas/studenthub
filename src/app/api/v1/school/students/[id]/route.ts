import { defineRoute } from "@/lib/http/route";
import { deleteStudent } from "@/lib/students/account-service";
import { deleteStudentContract, getStudentContract, updateStudentContract } from "@/lib/students/contracts";
import { getStudentDetail } from "@/lib/students/queries";
import { updateStudent } from "@/lib/students/update-service";

export const runtime = "nodejs";
export const GET = defineRoute(getStudentContract, async ({ params, query }, ctx) => ({ data: await getStudentDetail(ctx, query.schoolId, params.id) }));
export const PATCH = defineRoute(updateStudentContract, async ({ params, query, body }, ctx) => ({
  data: await updateStudent(ctx, query.schoolId, params.id, body),
}));
export const DELETE = defineRoute(deleteStudentContract, async ({ params, query }, ctx) => ({ data: await deleteStudent(ctx, query.schoolId, params.id) }));
