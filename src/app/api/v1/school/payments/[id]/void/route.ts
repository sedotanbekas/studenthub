import { voidPaymentContract } from "@/lib/billing/contracts-invoices";
import { voidPayment } from "@/lib/billing/payment-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const POST = defineRoute(voidPaymentContract, async ({ params, query, body }, ctx) => ({
  data: await voidPayment(ctx, query.schoolId, params.id, body),
}));
