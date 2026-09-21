import { defineRoute } from "@/lib/http/route";
import { getOwnReportCardContract } from "@/lib/report-cards/contracts";
import { getOwnReportCard } from "@/lib/report-cards/student-queries";

export const runtime = "nodejs";
export const GET = defineRoute(getOwnReportCardContract, async ({ params }, ctx) => ({ data: await getOwnReportCard(ctx, params.id) }));
