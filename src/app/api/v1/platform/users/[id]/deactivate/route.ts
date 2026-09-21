import { defineRoute } from "@/lib/http/route";
import { deactivatePlatformUserContract } from "@/lib/users/contracts";
import { deactivateUser } from "@/lib/users/service";

export const runtime = "nodejs";

export const POST = defineRoute(deactivatePlatformUserContract, async ({ params, body }, ctx) => ({
  data: await deactivateUser(params.id, body.reason, ctx),
}));
