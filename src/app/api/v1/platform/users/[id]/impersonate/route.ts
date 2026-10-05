import { startImpersonation } from "@/lib/auth/impersonation-service";
import { defineRoute } from "@/lib/http/route";
import { impersonatePlatformUserContract } from "@/lib/users/contracts";

export const runtime = "nodejs";

export const POST = defineRoute(impersonatePlatformUserContract, async ({ params }, ctx) => ({ data: await startImpersonation(params.id, ctx) }));
