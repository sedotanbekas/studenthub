import { cashPaymentContract } from "@/lib/billing/contracts-invoices";
import { recordCashPayment } from "@/lib/billing/payment-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const POST = defineRoute(cashPaymentContract, async ({ params, query, body }, ctx) => ({
  data: await recordCashPayment(ctx, query.schoolId, params.id, body),
  status: 201,
}));
