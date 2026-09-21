import { registerPushTokenContract, removePushTokenContract } from "@/lib/auth/contracts";
import { registerPushToken, removePushToken } from "@/lib/auth/session-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const PUT = defineRoute(registerPushTokenContract, async ({ body }, ctx) => ({ data: await registerPushToken(body.expoPushToken, ctx) }));
export const DELETE = defineRoute(removePushTokenContract, async (_input, ctx) => ({ data: await removePushToken(ctx) }));
