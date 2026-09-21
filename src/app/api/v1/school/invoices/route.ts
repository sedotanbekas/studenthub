import { createInvoiceContract, listInvoicesContract } from "@/lib/billing/contracts-invoices";
import { listInvoices } from "@/lib/billing/invoice-queries";
import { createInvoice } from "@/lib/billing/invoice-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(listInvoicesContract, async ({ query }, ctx) => listInvoices(ctx, query));
export const POST = defineRoute(createInvoiceContract, async ({ query, body }, ctx) => ({
  data: await createInvoice(ctx, query.schoolId, body),
  status: 201,
}));
