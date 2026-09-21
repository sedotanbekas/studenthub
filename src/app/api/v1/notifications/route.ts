import { defineRoute } from "@/lib/http/route";
import { listNotificationsContract } from "@/lib/notifications/contracts";
import { listInbox } from "@/lib/notifications/queries";

export const runtime = "nodejs";
export const GET = defineRoute(listNotificationsContract, async ({ query }, ctx) => {
  const page = await listInbox(query, ctx);
  return { data: page.items, meta: page.meta };
});
