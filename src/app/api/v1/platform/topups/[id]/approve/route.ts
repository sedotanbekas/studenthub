import { defineRoute } from "@/lib/http/route";
import { approveTopUpContract } from "@/lib/sponsors/contracts-platform";
import { approveTopUp } from "@/lib/sponsors/topup-service";

export const runtime = "nodejs";
export const POST = defineRoute(approveTopUpContract, async ({ params }, ctx) => ({ data: await approveTopUp(params.id, ctx) }));
