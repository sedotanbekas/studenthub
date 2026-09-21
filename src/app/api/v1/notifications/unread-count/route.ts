import { defineRoute } from "@/lib/http/route";
import { getUnreadNotificationCountContract } from "@/lib/notifications/contracts";
import { unreadCounts } from "@/lib/notifications/queries";

export const runtime = "nodejs";
export const GET = defineRoute(getUnreadNotificationCountContract, async (_input, ctx) => ({ data: await unreadCounts(ctx) }));
