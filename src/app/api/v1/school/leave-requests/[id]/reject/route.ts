import { rejectLeaveContract } from "@/lib/attendance/contracts-leave";
import { rejectLeave } from "@/lib/attendance/leave-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const POST = defineRoute(rejectLeaveContract, async ({ params, query, body }, ctx) => ({
  data: await rejectLeave(ctx, query.schoolId, params.id, body),
}));
