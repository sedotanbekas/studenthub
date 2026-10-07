import { removeAppLogoContract, uploadAppLogoContract } from "@/lib/app-settings/contracts";
import { removeAppLogo, uploadAppLogo } from "@/lib/app-settings/service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const POST = defineRoute(uploadAppLogoContract, async ({ body }, ctx) => ({ data: await uploadAppLogo(body, ctx) }));
export const DELETE = defineRoute(removeAppLogoContract, async (_input, ctx) => ({ data: await removeAppLogo(ctx) }));
