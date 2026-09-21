import { defineRoute } from "@/lib/http/route";
import { revokePlatformUserSessionsContract } from "@/lib/users/contracts";
import { revokeUserSessions } from "@/lib/users/service";

export const runtime = "nodejs";

export const POST = defineRoute(revokePlatformUserSessionsContract, async ({ params }, ctx) => ({
  data: await revokeUserSessions(params.id, ctx),
}));
