import { createOwnLeaveContract, listOwnLeavesContract } from "@/lib/attendance/contracts-leave";
import { listOwnLeaves } from "@/lib/attendance/leave-queries";
import { createOwnLeave } from "@/lib/attendance/leave-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(listOwnLeavesContract, async ({ query }, ctx) => listOwnLeaves(ctx, query));
export const POST = defineRoute(createOwnLeaveContract, async ({ body }, ctx) => ({ data: await createOwnLeave(ctx, body), status: 201 }));
