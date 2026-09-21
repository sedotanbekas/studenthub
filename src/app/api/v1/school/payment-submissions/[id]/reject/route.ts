import { rejectSubmissionContract } from "@/lib/billing/contracts-review";
import { rejectSubmission } from "@/lib/billing/review-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const POST = defineRoute(rejectSubmissionContract, async ({ params, query, body }, ctx) => ({
  data: await rejectSubmission(ctx, query.schoolId, params.id, body),
}));
