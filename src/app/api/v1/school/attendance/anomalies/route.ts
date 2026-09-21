import { anomaliesContract } from "@/lib/attendance/contracts-monitor";
import { listAnomalies } from "@/lib/attendance/monitoring-queries";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(anomaliesContract, async ({ query }, ctx) => listAnomalies(ctx, query));
