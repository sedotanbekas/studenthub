import { getAppSettingsContract, updateAppSettingsContract } from "@/lib/app-settings/contracts";
import { getAppSettingsDto, updateAppSettings } from "@/lib/app-settings/service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(getAppSettingsContract, async () => ({ data: await getAppSettingsDto() }));
export const PATCH = defineRoute(updateAppSettingsContract, async ({ body }, ctx) => ({ data: await updateAppSettings(body, ctx) }));
