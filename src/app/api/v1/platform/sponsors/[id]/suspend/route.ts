import { defineRoute } from "@/lib/http/route";
import { transitionSponsor } from "@/lib/sponsors/account-service";
import { suspendSponsorContract } from "@/lib/sponsors/contracts-platform";

export const runtime = "nodejs";
export const POST = defineRoute(suspendSponsorContract, async ({ params, body }, ctx) => ({ data: await transitionSponsor(params.id, "suspend", body.reason, ctx) }));
