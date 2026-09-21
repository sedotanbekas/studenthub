import { getOwnLeaveContract } from "@/lib/attendance/contracts-leave";
import { getOwnLeave } from "@/lib/attendance/leave-queries";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(getOwnLeaveContract, async ({ params }, ctx) => ({ data: await getOwnLeave(ctx, params.id) }));
