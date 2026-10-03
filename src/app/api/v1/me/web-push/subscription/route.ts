import { defineRoute } from "@/lib/http/route";
import { removeMyWebPushSubscriptionContract, upsertMyWebPushSubscriptionContract } from "@/lib/push/web/contracts";
import { removeMyWebPushSubscription, upsertMyWebPushSubscription } from "@/lib/push/web/service";

export const runtime = "nodejs";
export const PUT = defineRoute(upsertMyWebPushSubscriptionContract, async ({ body }, ctx) => ({ data: await upsertMyWebPushSubscription(body, ctx) }));
export const DELETE = defineRoute(removeMyWebPushSubscriptionContract, async (_input, ctx) => ({ data: await removeMyWebPushSubscription(ctx) }));
