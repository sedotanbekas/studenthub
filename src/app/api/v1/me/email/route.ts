import { updateLoginEmail } from "@/lib/auth/account-settings-service";
import { updateLoginEmailContract } from "@/lib/auth/contracts";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const PUT = defineRoute(updateLoginEmailContract, async ({ body }, ctx) => ({ data: await updateLoginEmail(body, ctx) }));
