import { recordDetailContract } from "@/lib/attendance/contracts-monitor";
import { getRecordDetail } from "@/lib/attendance/monitoring-queries";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(recordDetailContract, async ({ params, query }, ctx) => ({ data: await getRecordDetail(ctx, params.id, query.schoolId) }));
