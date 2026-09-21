import { defineRoute } from "@/lib/http/route";
import { markAllNotificationsReadContract } from "@/lib/notifications/contracts";
import { markAllRead } from "@/lib/notifications/inbox-service";

export const runtime = "nodejs";
export const POST = defineRoute(markAllNotificationsReadContract, async ({ body }, ctx) => ({ data: await markAllRead(body, ctx) }));
