import { approveLeaveContract } from "@/lib/attendance/contracts-leave";
import { approveLeave } from "@/lib/attendance/leave-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const POST = defineRoute(approveLeaveContract, async ({ params, query, body }, ctx) => ({
  data: await approveLeave(ctx, query.schoolId, params.id, body),
}));
