import { defineRoute } from "@/lib/http/route";
import { transitionSponsor } from "@/lib/sponsors/account-service";
import { reactivateSponsorContract } from "@/lib/sponsors/contracts-platform";

export const runtime = "nodejs";
export const POST = defineRoute(reactivateSponsorContract, async ({ params }, ctx) => ({ data: await transitionSponsor(params.id, "reactivate", null, ctx) }));
