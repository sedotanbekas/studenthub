import { defineRoute } from "@/lib/http/route";
import { markNotificationReadContract } from "@/lib/notifications/contracts";
import { markRead } from "@/lib/notifications/inbox-service";

export const runtime = "nodejs";
export const POST = defineRoute(markNotificationReadContract, async ({ params }, ctx) => ({ data: await markRead(params.id, ctx) }));
