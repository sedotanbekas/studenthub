import { defineRoute } from "@/lib/http/route";
import { getMyWebPushStatusContract } from "@/lib/push/web/contracts";
import { getMyWebPushStatus } from "@/lib/push/web/service";

export const runtime = "nodejs";
export const GET = defineRoute(getMyWebPushStatusContract, async (_input, ctx) => ({ data: await getMyWebPushStatus(ctx) }));
