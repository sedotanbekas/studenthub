import { defineRoute } from "@/lib/http/route";
import { adjustBalance } from "@/lib/sponsors/balance-service";
import { adjustLedgerContract } from "@/lib/sponsors/contracts-platform";

export const runtime = "nodejs";
export const POST = defineRoute(adjustLedgerContract, async ({ params, body }, ctx) => ({ data: await adjustBalance(params.id, body, ctx), status: 201 }));
