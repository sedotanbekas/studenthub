import { lateReasonContract } from "@/lib/attendance/contracts-student";
import { setOwnLateReason } from "@/lib/attendance/late-reason-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const PUT = defineRoute(lateReasonContract, async ({ body }, ctx) => ({ data: await setOwnLateReason(body, ctx) }));
