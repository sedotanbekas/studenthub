import { defineRoute } from "@/lib/http/route";
import { getMyNotificationPreferencesContract, updateMyNotificationPreferencesContract } from "@/lib/notifications/contracts";
import { getMyNotificationPreferences, updateMyNotificationPreferences } from "@/lib/notifications/preferences-service";

export const runtime = "nodejs";
export const GET = defineRoute(getMyNotificationPreferencesContract, async (_input, ctx) => ({ data: await getMyNotificationPreferences(ctx) }));
export const PUT = defineRoute(updateMyNotificationPreferencesContract, async ({ body }, ctx) => ({ data: await updateMyNotificationPreferences(body, ctx) }));
