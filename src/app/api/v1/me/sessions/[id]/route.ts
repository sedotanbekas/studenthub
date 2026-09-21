import { revokeMySessionContract } from "@/lib/auth/contracts";
import { revokeOwnSession } from "@/lib/auth/session-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const DELETE = defineRoute(revokeMySessionContract, async ({ params }, ctx) => ({ data: await revokeOwnSession(params.id, ctx) }));
