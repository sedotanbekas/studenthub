import { reviewAnomalyContract } from "@/lib/attendance/contracts-admin";
import { reviewAnomaly } from "@/lib/attendance/anomaly-review-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const POST = defineRoute(reviewAnomalyContract, async ({ params, query, body }, ctx) => ({
  data: await reviewAnomaly(ctx, query.schoolId, params.id, body),
}));
