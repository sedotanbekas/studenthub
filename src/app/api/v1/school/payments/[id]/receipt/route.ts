import { schoolReceiptContract } from "@/lib/billing/contracts-invoices";
import { getSchoolReceipt } from "@/lib/billing/receipt-queries";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(schoolReceiptContract, async ({ params, query }, ctx) => ({
  data: await getSchoolReceipt(ctx, query.schoolId, params.id),
}));
