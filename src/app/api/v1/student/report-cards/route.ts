import { defineRoute } from "@/lib/http/route";
import { listOwnReportCardsContract } from "@/lib/report-cards/contracts";
import { listOwnReportCards } from "@/lib/report-cards/student-queries";

export const runtime = "nodejs";
export const GET = defineRoute(listOwnReportCardsContract, async (_input, ctx) => ({ data: await listOwnReportCards(ctx) }));
