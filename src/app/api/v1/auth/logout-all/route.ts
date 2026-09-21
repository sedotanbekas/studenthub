import { logoutAllContract } from "@/lib/auth/contracts";
import { logoutEverywhere } from "@/lib/auth/session-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const POST = defineRoute(logoutAllContract, async (_input, ctx) => ({ data: await logoutEverywhere(ctx) }));
