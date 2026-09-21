import { defineRoute } from "@/lib/http/route";
import { activatePlatformUserContract } from "@/lib/users/contracts";
import { activateUser } from "@/lib/users/service";

export const runtime = "nodejs";

export const POST = defineRoute(activatePlatformUserContract, async ({ params }, ctx) => ({ data: await activateUser(params.id, ctx) }));
