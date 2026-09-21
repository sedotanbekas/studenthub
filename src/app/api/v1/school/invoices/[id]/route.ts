import { getInvoiceContract, updateInvoiceContract } from "@/lib/billing/contracts-invoices";
import { getInvoiceDetail } from "@/lib/billing/invoice-queries";
import { updateInvoice } from "@/lib/billing/invoice-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(getInvoiceContract, async ({ params, query }, ctx) => ({
  data: await getInvoiceDetail(ctx, query.schoolId, params.id),
}));
export const PATCH = defineRoute(updateInvoiceContract, async ({ params, query, body }, ctx) => ({
  data: await updateInvoice(ctx, query.schoolId, params.id, body),
}));
