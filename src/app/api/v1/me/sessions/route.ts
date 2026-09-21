import { listMySessionsContract } from "@/lib/auth/contracts";
import { listOwnSessions } from "@/lib/auth/session-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(listMySessionsContract, async (_input, ctx) => ({ data: await listOwnSessions(ctx) }));
