import { getSubmissionContract } from "@/lib/billing/contracts-review";
import { getSubmissionDetail } from "@/lib/billing/submission-queries";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(getSubmissionContract, async ({ params, query }, ctx) => ({
  data: await getSubmissionDetail(ctx, query.schoolId, params.id),
}));
