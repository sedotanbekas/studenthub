import { defineRoute } from "@/lib/http/route";
import { transitionSponsor } from "@/lib/sponsors/account-service";
import { approveSponsorContract } from "@/lib/sponsors/contracts-platform";

export const runtime = "nodejs";
export const POST = defineRoute(approveSponsorContract, async ({ params }, ctx) => ({ data: await transitionSponsor(params.id, "approve", null, ctx) }));
