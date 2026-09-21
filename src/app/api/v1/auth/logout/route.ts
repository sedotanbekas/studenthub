import { logoutContract } from "@/lib/auth/contracts";
import { logoutCurrent } from "@/lib/auth/session-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const POST = defineRoute(logoutContract, async (_input, ctx) => ({ data: await logoutCurrent(ctx) }));
