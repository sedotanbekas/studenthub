import { cancelOwnLeaveContract } from "@/lib/attendance/contracts-leave";
import { cancelOwnLeave } from "@/lib/attendance/leave-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const POST = defineRoute(cancelOwnLeaveContract, async ({ params }, ctx) => ({ data: await cancelOwnLeave(ctx, params.id) }));
