import { getSchoolLeaveContract } from "@/lib/attendance/contracts-leave";
import { getSchoolLeave } from "@/lib/attendance/leave-queries";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(getSchoolLeaveContract, async ({ params, query }, ctx) => ({ data: await getSchoolLeave(ctx, query.schoolId, params.id) }));
