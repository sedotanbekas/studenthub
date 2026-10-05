import { endImpersonationContract } from "@/lib/auth/contracts";
import { endImpersonation } from "@/lib/auth/impersonation-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";

export const POST = defineRoute(endImpersonationContract, async (_input, ctx) => ({ data: await endImpersonation(ctx) }));
