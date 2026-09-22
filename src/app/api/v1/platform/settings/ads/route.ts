import { defineRoute } from "@/lib/http/route";
import { getAdSettingsContract, updateAdSettingsContract } from "@/lib/sponsors/contracts-platform";
import { getAdSettingsDto, updateAdSettings } from "@/lib/sponsors/settings-service";

export const runtime = "nodejs";
export const GET = defineRoute(getAdSettingsContract, async (_input) => ({ data: await getAdSettingsDto() }));
export const PATCH = defineRoute(updateAdSettingsContract, async ({ body }, ctx) => ({ data: await updateAdSettings(body, ctx) }));
