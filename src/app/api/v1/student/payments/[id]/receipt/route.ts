import { ownReceiptContract } from "@/lib/billing/contracts-student";
import { getOwnReceipt } from "@/lib/billing/receipt-queries";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(ownReceiptContract, async ({ params }, ctx) => ({ data: await getOwnReceipt(ctx, params.id) }));
