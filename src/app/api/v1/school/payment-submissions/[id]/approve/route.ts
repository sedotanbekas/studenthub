import { approveSubmissionContract } from "@/lib/billing/contracts-review";
import { approveSubmission } from "@/lib/billing/review-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const POST = defineRoute(approveSubmissionContract, async ({ params, query, body }, ctx) => ({
  data: await approveSubmission(ctx, query.schoolId, params.id, body),
}));
