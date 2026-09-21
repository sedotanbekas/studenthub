import { createLeaveOnBehalfContract, listSchoolLeavesContract } from "@/lib/attendance/contracts-leave";
import { listSchoolLeaves } from "@/lib/attendance/leave-queries";
import { createLeaveOnBehalf } from "@/lib/attendance/leave-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(listSchoolLeavesContract, async ({ query }, ctx) => listSchoolLeaves(ctx, query));
export const POST = defineRoute(createLeaveOnBehalfContract, async ({ query, body }, ctx) => ({
  data: await createLeaveOnBehalf(ctx, query.schoolId, body),
  status: 201,
}));
