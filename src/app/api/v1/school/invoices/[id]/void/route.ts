import { voidInvoiceContract } from "@/lib/billing/contracts-invoices";
import { voidInvoice } from "@/lib/billing/invoice-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const POST = defineRoute(voidInvoiceContract, async ({ params, query, body }, ctx) => ({
  data: await voidInvoice(ctx, query.schoolId, params.id, body),
}));
