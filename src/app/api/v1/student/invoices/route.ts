import { listOwnInvoicesContract } from "@/lib/billing/contracts-student";
import { listMyInvoices } from "@/lib/billing/student-queries";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(listOwnInvoicesContract, async ({ query }, ctx) => listMyInvoices(ctx, query));
