import { defineRoute } from "@/lib/http/route";
import { createStudentContract, listStudentsContract } from "@/lib/students/contracts";
import { createStudent } from "@/lib/students/create-service";
import { listStudents } from "@/lib/students/queries";

export const runtime = "nodejs";
export const GET = defineRoute(listStudentsContract, async ({ query }, ctx) => listStudents(ctx, query));
export const POST = defineRoute(createStudentContract, async ({ query, body }, ctx) => ({
  data: await createStudent(ctx, query.schoolId, body),
  status: 201,
}));
