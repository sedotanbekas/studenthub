import { bulkCreateInvoices } from "@/lib/billing/bulk-service";
import { bulkInvoicesContract } from "@/lib/billing/contracts-invoices";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const POST = defineRoute(bulkInvoicesContract, async ({ query, body }, ctx) => ({
  data: await bulkCreateInvoices(ctx, query.schoolId, body),
}));
