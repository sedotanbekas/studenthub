import { getOwnInvoiceContract } from "@/lib/billing/contracts-student";
import { getMyInvoice } from "@/lib/billing/student-queries";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(getOwnInvoiceContract, async ({ params }, ctx) => ({ data: await getMyInvoice(ctx, params.id) }));
