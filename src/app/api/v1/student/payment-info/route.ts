import { paymentInfoContract } from "@/lib/billing/contracts-student";
import { getMyPaymentInfo } from "@/lib/billing/student-queries";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(paymentInfoContract, async (_input, ctx) => ({ data: await getMyPaymentInfo(ctx) }));
