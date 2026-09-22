import { defineRoute } from "@/lib/http/route";
import { rejectTopUpContract } from "@/lib/sponsors/contracts-platform";
import { rejectTopUp } from "@/lib/sponsors/topup-service";

export const runtime = "nodejs";
export const POST = defineRoute(rejectTopUpContract, async ({ params, body }, ctx) => ({ data: await rejectTopUp(params.id, body.reason, ctx) }));
