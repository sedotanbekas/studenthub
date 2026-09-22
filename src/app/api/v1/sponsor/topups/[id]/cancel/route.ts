import { defineRoute } from "@/lib/http/route";
import { cancelOwnTopUpContract } from "@/lib/sponsors/contracts-self";
import { cancelOwnTopUp } from "@/lib/sponsors/topup-service";

export const runtime = "nodejs";
export const POST = defineRoute(cancelOwnTopUpContract, async ({ params }, ctx) => ({ data: await cancelOwnTopUp(ctx, params.id) }));
