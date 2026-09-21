import { cancelOwnSubmissionContract } from "@/lib/billing/contracts-student";
import { cancelOwnSubmission } from "@/lib/billing/submission-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const POST = defineRoute(cancelOwnSubmissionContract, async ({ params }, ctx) => ({ data: await cancelOwnSubmission(ctx, params.id) }));
