import { restoreInvoiceContract } from "@/lib/billing/contracts-invoices";
import { restoreInvoice } from "@/lib/billing/invoice-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const POST = defineRoute(restoreInvoiceContract, async ({ params, query }, ctx) => ({
  data: await restoreInvoice(ctx, query.schoolId, params.id),
}));
