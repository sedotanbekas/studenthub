import { meContract } from "@/lib/auth/contracts";
import { getMe } from "@/lib/auth/me-query";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(meContract, async (_input, ctx) => ({ data: await getMe(ctx) }));
