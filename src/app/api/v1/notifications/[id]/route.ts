import { defineRoute } from "@/lib/http/route";
import { getNotificationContract } from "@/lib/notifications/contracts";
import { getInboxItem } from "@/lib/notifications/queries";

export const runtime = "nodejs";
export const GET = defineRoute(getNotificationContract, async ({ params }, ctx) => ({ data: await getInboxItem(params.id, ctx) }));
