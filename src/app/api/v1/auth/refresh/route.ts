import { refreshContract } from "@/lib/auth/contracts";
import { refreshSession } from "@/lib/auth/refresh-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const POST = defineRoute(refreshContract, async ({ body }, ctx) => ({ data: await refreshSession(body.refreshToken, ctx) }));
